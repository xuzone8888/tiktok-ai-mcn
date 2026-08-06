import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { querySeedanceTask, submitSeedanceTask, getSeedanceParams, needsUpscaling } from "@/lib/seedance-api";
import { upscaleVideoFile, getUpscaleTarget } from "@/lib/video-upscale";
import { transferVideoToOss } from "../storage";
import type { VideoModelAdapter, VideoQuality } from "../types";

export function resolveSeedanceModel(input: {
  durationSeconds?: number;
  quality?: VideoQuality;
}): string {
  const duration = input.durationSeconds === undefined ? 5 : input.durationSeconds;
  const quality = input.quality === undefined ? "standard" : input.quality;

  if (duration !== 5 && duration !== 10) {
    throw new RangeError(`Seedance does not support duration ${String(input.durationSeconds)}`);
  }
  if (quality !== "standard" && quality !== "hd") {
    throw new RangeError(`Seedance does not support quality ${String(input.quality)}`);
  }

  if (quality === "hd") return duration === 10 ? "seedance-10s-pro" : "seedance-5s-pro";
  return duration === 10 ? "seedance-10s" : "seedance-5s";
}

export const seedanceAdapter: VideoModelAdapter = {
  async submit(input) {
    const model = resolveSeedanceModel(input);
    const { duration, resolution } = getSeedanceParams(model);
    const result = await submitSeedanceTask({
      prompt: input.prompt,
      imageUrl: input.imageUrls[0],
      duration,
      resolution,
      ratio: input.aspectRatio,
    });

    if (result.status === "failed" || !result.taskId) {
      throw new Error(result.error || "Seedance 视频提交失败");
    }

    return {
      taskId: result.taskId,
      status: "processing",
      upstreamModel: model,
      metadata: {
        provider: "volcengine",
        model,
        resolution,
        generate_audio: true,
        reference_image_count: input.imageUrls[0] ? 1 : 0,
      },
    };
  },

  async status(input) {
    const result = await querySeedanceTask(input.taskId);
    if (result.status === "failed") {
      return {
        taskId: input.taskId,
        status: "failed",
        errorMessage: result.error || "Seedance 视频生成失败",
      };
    }

    if (result.status === "succeeded" && result.videoUrl) {
      return {
        taskId: input.taskId,
        status: "completed",
        videoUrl: result.videoUrl,
        progress: 100,
        metadata: {
          tokens: result.tokens,
        },
      };
    }

    return {
      taskId: input.taskId,
      status: "processing",
      progress: result.status === "queued" ? 10 : 50,
    };
  },

  async complete(input) {
    if (!input.status.videoUrl) {
      throw new Error("Seedance 完成任务缺少视频 URL");
    }

    const model = resolveSeedanceModel(input);
    const ratio = input.aspectRatio || "9:16";
    const shouldUpscale = needsUpscaling(model);
    let upscaled = false;
    const ossUrl = await transferVideoToOss({
      taskId: input.taskId,
      modelType: "seedance",
      videoUrl: input.status.videoUrl,
      userId: input.generationUserId || input.userId,
      targetObjectKey: input.targetObjectKey,
      outputMetadata: input.outputMetadata,
      signal: input.signal,
      prepareFile: shouldUpscale
        ? async ({ filePath, signal }) => {
            const directory = await mkdtemp(
              join(tmpdir(), "stargaze-seedance-upscale-")
            );
            const outputPath = join(directory, "upscaled.mp4");
            const target = getUpscaleTarget(ratio);
            const result = await upscaleVideoFile({
              inputPath: filePath,
              outputPath,
              targetWidth: target.width,
              targetHeight: target.height,
              taskId: input.taskId,
              signal,
            });
            if (!result.success) {
              await rm(directory, { recursive: true, force: true });
              return { filePath };
            }
            upscaled = true;
            return {
              filePath: outputPath,
              cleanup: () =>
                rm(directory, { recursive: true, force: true }),
            };
          }
        : undefined,
    });

    return {
      videoUrl: ossUrl,
      metadata: {
        seedance_model: model,
        upscaled,
      },
    };
  },
};
