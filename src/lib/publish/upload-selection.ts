export interface UploadedVideoSelection {
  id: string
  type: 'upload'
  name: string
  thumbnail: string
  url: string
  localUrl?: string
  duration?: number
  size: number
  contentType: string
  title: string
  description: string
}

export function createUploadedVideoSelection(input: {
  id: string
  name: string
  publicUrl: string
  thumbnail: string
  duration: number
  size: number
  contentType: string
  title: string
  localUrl?: string
}): UploadedVideoSelection {
  return {
    id: input.id,
    type: 'upload',
    name: input.name,
    thumbnail: input.thumbnail,
    url: input.publicUrl,
    localUrl: input.localUrl,
    duration: input.duration,
    size: input.size,
    contentType: input.contentType,
    title: input.title,
    description: '',
  }
}

export function mergeSelectedVideos<T extends { id: string }>(
  current: readonly T[],
  uploaded: readonly T[],
  limit: number
): T[] {
  const existingIds = new Set(current.map((video) => video.id))
  const next = [...current]

  for (const video of uploaded) {
    if (existingIds.has(video.id) || next.length >= limit) continue
    existingIds.add(video.id)
    next.push(video)
  }

  return next
}

export function commitUploadResults<T extends { id: string }>(
  current: readonly T[],
  results: readonly (T | null)[],
  limit: number
): T[] {
  const uploaded = results.filter((video): video is T => video !== null)
  return uploaded.length > 0 ? mergeSelectedVideos(current, uploaded, limit) : [...current]
}

export function removeSelectedVideo<T extends { id: string }>(
  current: readonly T[],
  videoId: string
): T[] {
  return current.filter((video) => video.id !== videoId)
}

export function isPlatformPublishReady(input: {
  selectedVideoCount: number
  selectedAccountCount: number
  privacySelected: boolean
  isPublishing: boolean
}) {
  return input.selectedVideoCount > 0 &&
    input.selectedAccountCount > 0 &&
    input.privacySelected &&
    !input.isPublishing
}
