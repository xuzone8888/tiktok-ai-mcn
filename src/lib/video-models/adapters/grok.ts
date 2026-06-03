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
    const imageUrls = input.imageUrls.slice(0, 4);
    const model = "grok-imagine-1.0-video";
    const task = await submitPlatformVideo({
      model,
      prompt: input.prompt,
      size: toPlatformSize(input.aspectRatio, "720p"),
      seconds: "10",
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
