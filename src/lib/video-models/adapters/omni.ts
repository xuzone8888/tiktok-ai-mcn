import {
  getPlatformAuthHeaders,
  getPlatformContentUrl,
  queryPlatformVideoTask,
  submitPlatformVideo,
} from "../platform-client";
import type { VideoModelAdapter } from "../types";

function getOmniRequestSize(aspectRatio: "9:16" | "16:9") {
  return aspectRatio === "16:9" ? "1920x1080" : "1080x1920";
}

export const omniAdapter: VideoModelAdapter = {
  async submit(input) {
    const imageUrls = input.imageUrls.slice(0, 7);
    const model = "omni_flash";
    const task = await submitPlatformVideo(
      {
        model,
        prompt: input.prompt,
        size: getOmniRequestSize(input.aspectRatio),
        seconds: "10",
        input_reference: JSON.stringify(imageUrls),
      },
      input.atMostOnce
        ? ["/v1/videos?async=true"]
        : ["/v1/videos?async=true", "/api/v1/generate"]
    );

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
