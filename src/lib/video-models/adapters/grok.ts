import {
  getPlatformAuthHeaders,
  getPlatformContentUrl,
  queryPlatformVideoTask,
  submitPlatformVideo,
  toPlatformSize,
} from "../platform-client";
import type { VideoModelAdapter } from "../types";

export const grokAdapter: VideoModelAdapter = {
  async submit(input) {
    if (input.durationSeconds !== 10 && input.durationSeconds !== 15) {
      throw new Error("Grok duration must be validated as 10 or 15 seconds");
    }
    if (input.imageUrls.length > 4) {
      throw new Error("Grok supports at most 4 reference images");
    }

    const imageUrls = input.imageUrls;
    const model = "grok-imagine-1.0-video";
    const task = await submitPlatformVideo({
      model,
      prompt: input.prompt,
      size: toPlatformSize(input.aspectRatio, "720p"),
      seconds: String(input.durationSeconds),
      async: true,
      ...(imageUrls.length > 0 ? { image_reference: imageUrls } : {}),
    });

    return {
      taskId: task.taskId,
      status: "processing",
      upstreamModel: model,
      metadata: {
        provider: "video-platform",
        model,
        duration_seconds: input.durationSeconds,
        reference_image_count: imageUrls.length,
        resolution: "720P",
      },
    };
  },

  async status(input) {
    const task = await queryPlatformVideoTask(input.taskId);
    return {
      taskId: task.taskId || input.taskId,
      status: task.status,
      progress: task.progress,
      videoUrl: task.videoUrl,
      errorMessage: task.errorMessage,
      contentUrl: task.status === "completed" && !task.videoUrl
        ? getPlatformContentUrl(input.taskId)
        : undefined,
      contentHeaders: task.status === "completed" && !task.videoUrl
        ? getPlatformAuthHeaders()
        : undefined,
      metadata: task.raw,
    };
  },
};
