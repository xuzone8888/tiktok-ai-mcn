import {
  getPlatformAuthHeaders,
  getPlatformContentUrl,
  queryPlatformVideoTask,
  submitPlatformVideo,
  submitPlatformVideoMultipart,
} from "../platform-client";
import type { VideoModelAdapter } from "../types";

function getVeoModel(aspectRatio: "9:16" | "16:9"): string {
  return aspectRatio === "16:9"
    ? "veo_3_1-fast-landscape-hd"
    : "veo_3_1-fast-portrait-hd";
}

function getVeoRequestSize(aspectRatio: "9:16" | "16:9"): string {
  return aspectRatio === "16:9" ? "1920x1080" : "1080x1920";
}

export const veoAdapter: VideoModelAdapter = {
  async submit(input) {
    const imageUrls = input.imageUrls.slice(0, 3);
    const model = getVeoModel(input.aspectRatio);
    const task = imageUrls.length > 0
      ? await submitPlatformVideoMultipart({
          fields: {
            model,
            prompt: input.prompt,
            size: getVeoRequestSize(input.aspectRatio),
          },
          imageUrls,
          imageFieldName: "input_reference[]",
          paths: input.atMostOnce
            ? ["/v1/videos"]
            : ["/v1/videos", "/v1/videos?async=true"],
        })
      : await submitPlatformVideo(
          {
            model,
            prompt: input.prompt,
            size: getVeoRequestSize(input.aspectRatio),
          },
          input.atMostOnce
            ? ["/v1/videos?async=true"]
            : ["/v1/videos?async=true", "/v1/videos"]
        );

    return {
      taskId: task.taskId,
      status: "processing",
      upstreamModel: model,
      metadata: {
        provider: "video-platform",
        model,
        reference_image_count: imageUrls.length,
        submit_format: imageUrls.length > 0 ? "multipart/form-data" : "json",
        resolution: "1080P",
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
