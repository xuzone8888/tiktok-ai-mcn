import { querySeedanceTask, submitSeedanceTask, getSeedanceParams, needsUpscaling } from "@/lib/seedance-api";
import { upscaleVideo, getUpscaleTarget } from "@/lib/video-upscale";
import { generateMediaPath, uploadVideoBuffer } from "@/lib/oss";
import type { VideoModelAdapter, VideoModelSubmitInput } from "../types";

function getSeedanceModel(input: Pick<VideoModelSubmitInput, "durationSeconds" | "quality">): string {
  const duration = input.durationSeconds === 10 ? 10 : 5;
  const pro = input.quality === "hd";
  if (pro) return duration === 10 ? "seedance-10s-pro" : "seedance-5s-pro";
  return duration === 10 ? "seedance-10s" : "seedance-5s";
}

export const seedanceAdapter: VideoModelAdapter = {
  async submit(input) {
    const model = getSeedanceModel(input);
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

    const model = getSeedanceModel(input);
    const ratio = input.aspectRatio || "9:16";
    const response = await fetch(input.status.videoUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Seedance 源视频下载失败: HTTP ${response.status}`);
    }

    let videoBuffer = Buffer.from(new Uint8Array(await response.arrayBuffer()));
    if (needsUpscaling(model)) {
      const target = getUpscaleTarget(ratio);
      const upscaleResult = await upscaleVideo({
        inputBuffer: videoBuffer,
        targetWidth: target.width,
        targetHeight: target.height,
        taskId: input.taskId,
      });
      if (upscaleResult.success) {
        videoBuffer = Buffer.from(upscaleResult.outputBuffer);
      }
    }

    const ossPath = generateMediaPath(
      "quick-gen",
      input.generationUserId || input.userId || "unknown",
      `seedance-${input.taskId}.mp4`
    );
    const ossUrl = await uploadVideoBuffer(videoBuffer, ossPath, "video/mp4");

    return {
      videoUrl: ossUrl,
      metadata: {
        seedance_model: model,
        upscaled: needsUpscaling(model),
      },
    };
  },
};
