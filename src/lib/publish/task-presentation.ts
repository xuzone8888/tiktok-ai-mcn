/** Presentation only: never treat FILE_UPLOAD identifiers as playable media. */
export function taskVideoTitle(item: { title?: string | null; source_video_name?: string | null }) {
  return item.title?.trim() || item.source_video_name?.trim() || '未命名视频'
}

export function playableTaskVideoUrl(value?: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
