// Small thumbnails only; user-scoped sessionStorage survives refresh, not tab closure.
const previews = new Map<string, { image: string; expires: number }>()
const MAX_PREVIEWS = 24
const TTL_MS = 60 * 60 * 1000
const STORAGE_KEY = 'tiktok-task-previews:v1'
type ClearReason = 'signout' | 'delete'
const clearListeners = new Set<(reason: ClearReason) => void>()
const validImage = (image: unknown): image is string => typeof image === 'string' && image.length <= 100_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)

function storage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null } catch { return null }
}

function restore(now: number) {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    if (!raw || raw.length > 2_500_000) return
    const saved: unknown = JSON.parse(raw)
    if (!Array.isArray(saved)) return
    for (const pair of saved.slice(-MAX_PREVIEWS)) {
      if (!Array.isArray(pair) || pair.length !== 2) continue
      const [key, entry] = pair
      if (typeof key === 'string' && entry && validImage(entry.image) && Number.isFinite(entry.expires) && entry.expires > now && entry.expires <= now + TTL_MS) {
        if (!previews.has(key)) previews.set(key, entry)
      }
    }
  } catch { /* Unavailable/corrupt storage must never affect publishing. */ }
}

function persist(now: number) {
  for (const [key, value] of previews) if (value.expires <= now) previews.delete(key)
  while (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value!)
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify([...previews].filter(([key]) => !key.startsWith(':')))) } catch { /* Fall back to memory when quota is exhausted. */ }
}

export function rememberLocalTaskPreview(id: string, image: string, now = Date.now(), ownerId = '') {
  if (!id || !validImage(image)) return
  restore(now)
  const key = `${ownerId}:${id}`
  previews.delete(key)
  previews.set(key, { image, expires: now + TTL_MS })
  persist(now)
}

export function getLocalTaskPreview(id: string, now = Date.now(), ownerId = ''): string | null {
  restore(now)
  persist(now)
  const key = `${ownerId}:${id}`
  const entry = previews.get(key)
  if (!entry) return null
  if (entry.expires <= now) { previews.delete(key); persist(now); return null }
  return entry.image
}

export function clearLocalTaskPreviews(reason: ClearReason = 'signout') {
  previews.clear()
  try { storage()?.removeItem(STORAGE_KEY) } catch { /* Storage may be disabled. */ }
  for (const listener of clearListeners) listener(reason)
}

export function onLocalTaskPreviewsCleared(listener: (reason: ClearReason) => void) {
  clearListeners.add(listener)
  return () => { clearListeners.delete(listener) }
}

export function isLocalPreviewFile(file: { type: string; name: string }) {
  return ['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)
    || (!file.type && /\.(mp4|mov|webm)$/i.test(file.name))
}
