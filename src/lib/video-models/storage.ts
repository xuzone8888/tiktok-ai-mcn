import { createReadStream } from "node:fs";
import { open, readFile } from "node:fs/promises";
import {
  extractObjectPath,
  generateMediaPath,
  uploadVideoStream,
  type OssUserMetadata,
} from "@/lib/oss";
import { isOSSPermanentUrl } from "@/lib/transfer-veo-to-oss";
import {
  ExternalMediaFetchError,
  fetchExternalMediaToTempFile,
} from "@/lib/safe-media-fetch";
import type { VideoModelId } from "./types";

const DOWNLOAD_RETRY_DELAYS_MS = [0, 2_000, 5_000];
export const MAX_GENERATED_VIDEO_BYTES = 256 * 1024 * 1024;
const MAX_PROVIDER_JSON_BYTES = 2 * 1024 * 1024;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new Error("Video persistence aborted")
    );
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("Video persistence aborted")
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function transferVideoToOss(params: {
  taskId: string;
  modelType: VideoModelId;
  videoUrl: string;
  userId?: string;
  headers?: Record<string, string>;
  targetObjectKey?: string;
  outputMetadata?: OssUserMetadata;
  signal?: AbortSignal;
  prepareFile?: (input: {
    filePath: string;
    signal?: AbortSignal;
  }) => Promise<{
    filePath: string;
    cleanup?: () => Promise<void>;
  }>;
}): Promise<string> {
  return withVideoPersistenceSlot(
    () => transferVideoToOssInternal(params, 0, 1),
    params.signal
  );
}

interface PersistenceWaiter {
  resolve(): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

let videoPersistenceActive = false;
const videoPersistenceQueue: PersistenceWaiter[] = [];

function releaseVideoPersistenceSlot(): void {
  while (videoPersistenceQueue.length > 0) {
    const next = videoPersistenceQueue.shift()!;
    if (next.onAbort) {
      next.signal?.removeEventListener("abort", next.onAbort);
    }
    if (next.signal?.aborted) continue;
    next.resolve();
    return;
  }
  videoPersistenceActive = false;
}

async function acquireVideoPersistenceSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Video persistence aborted");
  }
  if (!videoPersistenceActive) {
    videoPersistenceActive = true;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter: PersistenceWaiter = { resolve, reject, signal };
    waiter.onAbort = () => {
      const index = videoPersistenceQueue.indexOf(waiter);
      if (index >= 0) videoPersistenceQueue.splice(index, 1);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("Video persistence aborted")
      );
    };
    signal?.addEventListener("abort", waiter.onAbort, { once: true });
    videoPersistenceQueue.push(waiter);
  });
}

async function withVideoPersistenceSlot<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  await acquireVideoPersistenceSlot(signal);
  try {
    return await operation();
  } finally {
    releaseVideoPersistenceSlot();
  }
}

async function assertMp4File(filePath: string): Promise<void> {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (
      bytesRead < 12 ||
      header.subarray(4, 8).toString("ascii") !== "ftyp"
    ) {
      throw new Error("Generated video payload is not a valid MP4 file");
    }
  } finally {
    await handle.close();
  }
}

function nestedVideoUrl(data: Record<string, any>): string | null {
  const value =
    data.url ||
    data.video_url ||
    data.result_url ||
    data.data?.url ||
    data.data?.video_url ||
    data.output?.video_url;
  return typeof value === "string" && value.startsWith("http")
    ? value
    : null;
}

async function transferVideoToOssInternal(
  params: {
    taskId: string;
    modelType: VideoModelId;
    videoUrl: string;
    userId?: string;
    headers?: Record<string, string>;
    targetObjectKey?: string;
    outputMetadata?: OssUserMetadata;
    signal?: AbortSignal;
    prepareFile?: (input: {
      filePath: string;
      signal?: AbortSignal;
    }) => Promise<{
      filePath: string;
      cleanup?: () => Promise<void>;
    }>;
  },
  nestedDepth: number,
  attempt: number
): Promise<string> {
  if (
    !params.prepareFile &&
    isOSSPermanentUrl(params.videoUrl) &&
    (!params.targetObjectKey ||
      extractObjectPath(params.videoUrl) === params.targetObjectKey)
  ) {
    return params.videoUrl;
  }

  let downloaded: Awaited<ReturnType<typeof fetchExternalMediaToTempFile>>;
  try {
    downloaded = await fetchExternalMediaToTempFile(params.videoUrl, {
      headers: params.headers,
      maxBytes: MAX_GENERATED_VIDEO_BYTES,
      timeoutMs: 150_000,
      signal: params.signal,
    });
  } catch (error) {
    const statusCode =
      error instanceof ExternalMediaFetchError ? error.statusCode : undefined;
    const retryable =
      statusCode === undefined ||
      statusCode >= 500 ||
      statusCode === 408 ||
      statusCode === 409 ||
      statusCode === 425 ||
      statusCode === 429;
    if (retryable && attempt < DOWNLOAD_RETRY_DELAYS_MS.length) {
      await wait(DOWNLOAD_RETRY_DELAYS_MS[attempt], params.signal);
      return transferVideoToOssInternal(params, nestedDepth, attempt + 1);
    }
    throw error;
  }

  try {
    if (downloaded.contentType.includes("application/json")) {
      if (nestedDepth >= 3) {
        throw new Error("视频内容接口嵌套跳转次数过多");
      }
      if (downloaded.size > MAX_PROVIDER_JSON_BYTES) {
        throw new Error("视频内容接口 JSON 响应过大");
      }
      const data = JSON.parse(
        await readFile(downloaded.filePath, "utf8")
      ) as Record<string, any>;
      const nestedUrl = nestedVideoUrl(data);
      if (!nestedUrl) {
        throw new Error("视频内容接口未返回可下载视频");
      }
      return transferVideoToOssInternal(
        {
          ...params,
          videoUrl: nestedUrl,
          headers: undefined,
        },
        nestedDepth + 1,
        1
      );
    }

    await assertMp4File(downloaded.filePath);
    const prepared = params.prepareFile
      ? await params.prepareFile({
          filePath: downloaded.filePath,
          signal: params.signal,
        })
      : null;
    const uploadPath = prepared?.filePath ?? downloaded.filePath;
    try {
      await assertMp4File(uploadPath);
      const ossPath =
        params.targetObjectKey ||
        generateMediaPath(
          "quick-gen",
          params.userId || "unknown",
          `${params.modelType}-${params.taskId}.mp4`
        );
      const stream = createReadStream(uploadPath);
      try {
        return await uploadVideoStream(stream, ossPath, "video/mp4", {
          metadata: params.outputMetadata,
          signal: params.signal,
        });
      } finally {
        stream.destroy();
      }
    } finally {
      await prepared?.cleanup?.().catch(() => {});
    }
  } finally {
    await downloaded.cleanup();
  }
}
