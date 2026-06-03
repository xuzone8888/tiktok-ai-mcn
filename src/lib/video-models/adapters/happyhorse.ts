import { queryHappyHorseVideo, submitHappyHorseVideo } from "@/lib/dashscope-video-api";
import type { Json } from "@/types/database";
import type { VideoModelAdapter } from "../types";

export const happyHorseAdapter: VideoModelAdapter = {
  async submit(input) {
    const duration = input.durationSeconds === 12 ? 12 : 5;
    const imageUrls = input.imageUrls.slice(0, 9);
    const result = await submitHappyHorseVideo({
      prompt: input.prompt,
      ratio: input.aspectRatio,
      duration,
      resolution: "720P",
      imageUrls,
    });

    if (!result.success || !result.taskId) {
      throw new Error(result.error || "HappyHorse 视频提交失败");
    }

    return {
      taskId: result.taskId,
      status: "processing",
      upstreamModel: result.model || (imageUrls.length > 0 ? "happyhorse-1.0-r2v" : "happyhorse-1.0-t2v"),
      metadata: {
        provider: "dashscope",
        model: result.model,
        request_id: result.requestId,
        resolution: "720P",
        reference_image_count: imageUrls.length,
        reference_image_urls: imageUrls,
      },
    };
  },

  async status(input) {
    const result = await queryHappyHorseVideo(input.taskId);
    if (!result.success || !result.task) {
      throw new Error(result.error || "HappyHorse 状态查询失败");
    }

    const task = result.task;
    return {
      taskId: task.taskId || input.taskId,
      status: task.status === "completed" ? "completed" : task.status === "failed" ? "failed" : "processing",
      progress: task.status === "completed" ? 100 : task.status === "failed" ? 0 : 50,
      videoUrl: task.videoUrl,
      errorMessage: task.errorMessage,
      metadata: {
        request_id: task.requestId || null,
        usage: (task.usage ?? null) as Json,
      } as Json,
    };
  },
};
