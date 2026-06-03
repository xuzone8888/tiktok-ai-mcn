import { generateMediaPath, uploadVideoBuffer } from "@/lib/oss";
import { isOSSPermanentUrl } from "@/lib/transfer-veo-to-oss";
import type { VideoModelId } from "./types";

const DOWNLOAD_RETRY_DELAYS_MS = [0, 2_000, 5_000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchVideoBuffer(
  url: string,
  headers?: Record<string, string>,
  attempt = 1
): Promise<{ buffer: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (attempt < DOWNLOAD_RETRY_DELAYS_MS.length) {
      await wait(DOWNLOAD_RETRY_DELAYS_MS[attempt]);
      return fetchVideoBuffer(url, headers, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (attempt < DOWNLOAD_RETRY_DELAYS_MS.length && response.status >= 500) {
      await wait(DOWNLOAD_RETRY_DELAYS_MS[attempt]);
      return fetchVideoBuffer(url, headers, attempt + 1);
    }
    throw new Error(`视频下载失败: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "video/mp4";
  const arrayBuffer = await response.arrayBuffer();

  if (contentType.includes("application/json")) {
    const text = Buffer.from(arrayBuffer).toString("utf8");
    const data = JSON.parse(text) as Record<string, any>;
    const nestedUrl =
      data.url ||
      data.video_url ||
      data.result_url ||
      data.data?.url ||
      data.data?.video_url ||
      data.output?.video_url;
    if (typeof nestedUrl === "string" && nestedUrl.startsWith("http")) {
      return fetchVideoBuffer(nestedUrl, undefined, attempt);
    }
    throw new Error("视频内容接口未返回可下载视频");
  }

  return {
    buffer: Buffer.from(new Uint8Array(arrayBuffer)),
    contentType: contentType.split(";")[0] || "video/mp4",
  };
}

export async function transferVideoToOss(params: {
  taskId: string;
  modelType: VideoModelId;
  videoUrl: string;
  userId?: string;
  headers?: Record<string, string>;
}): Promise<string> {
  if (isOSSPermanentUrl(params.videoUrl)) return params.videoUrl;

  const { buffer, contentType } = await fetchVideoBuffer(params.videoUrl, params.headers);
  const ossPath = generateMediaPath(
    "quick-gen",
    params.userId || "unknown",
    `${params.modelType}-${params.taskId}.mp4`
  );

  return uploadVideoBuffer(buffer, ossPath, contentType || "video/mp4");
}
