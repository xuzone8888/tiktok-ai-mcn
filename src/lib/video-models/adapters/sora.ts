import {
  getPlatformAuthHeaders,
  getPlatformContentUrl,
  queryPlatformVideoTask,
  submitPlatformVideo,
  toModelAspectToken,
} from "../platform-client";
import type {
  VideoModelAdapter,
  VideoModelSubmitInput,
  VideoModelStatusInput,
} from "../types";

function getSoraModel(input: VideoModelSubmitInput): string {
  const aspect = toModelAspectToken(input.aspectRatio);
  return input.modelType === "sora2-pro"
    ? `sora2-pro-12s-${aspect}`
    : `sora-2-12s-${aspect}`;
}

export const soraAdapter: VideoModelAdapter = {
  async submit(input) {
    const model = getSoraModel(input);
    const imageUrls = input.imageUrls.slice(0, 1);
    const task = await submitPlatformVideo({
      model,
      prompt: input.prompt,
      generate_audio: true,
      ...(imageUrls.length > 0 ? { reference_images: imageUrls } : {}),
    });

    return {
      taskId: task.taskId,
      status: "processing",
      upstreamModel: model,
      metadata: {
        provider: "video-platform",
        model,
        reference_image_count: imageUrls.length,
      },
    };
  },

  async status(input: VideoModelStatusInput) {
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
