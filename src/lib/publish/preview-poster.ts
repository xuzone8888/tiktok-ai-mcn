'use client'

/** Capture a bounded JPEG; always release the local decoder and object URL. */
export function createPreviewPoster(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      video.onloadeddata = null
      video.onerror = null
      video.pause()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
    const finish = (image?: string) => {
      if (settled) return
      settled = true
      cleanup()
      if (image) resolve(image)
      else reject(new Error('poster_unavailable'))
    }
    const timer = setTimeout(() => finish(), 20_000)
    const abort = () => finish()
    if (signal?.aborted) { finish(); return }
    signal?.addEventListener('abort', abort, { once: true })
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.onerror = () => finish()
    video.onloadeddata = () => {
      try {
        if (!video.videoWidth || !video.videoHeight) return finish()
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) return finish()
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', 0.7))
      } catch { finish() }
    }
    video.src = url
  })
}
