/** Saves a private source copy, not a second TikTok upload or verification of the remote post. */
export async function saveTaskPreview(itemId: string, file: File, thumbnail: string, options: { signal?: AbortSignal; isEnglish?: boolean } = {}) {
  const { signal, isEnglish = false } = options
  const fail = (zh: string, en: string) => new Error(isEnglish ? en : zh)
  signal?.throwIfAborted()
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(thumbnail) || thumbnail.length > 700_000) throw fail('视频封面生成失败，尚未开始发布', 'Cover generation failed; publishing has not started.')
  const bytes = Uint8Array.from(atob(thumbnail.split(',')[1]), char => char.charCodeAt(0))
  const poster = new Blob([bytes], { type: 'image/jpeg' })
  const endpoint = `/api/publish/previews/${encodeURIComponent(itemId)}`
  const reserved = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    body: JSON.stringify({ action: 'reserve', posterSize: poster.size, videoSize: file.size, videoType: file.type }),
  })
  const reservation = await reserved.json().catch(() => null)
  signal?.throwIfAborted()
  if (!reserved.ok || !reservation) throw fail('无法保存预览，请检查配置或配额；尚未开始发布', 'Preview storage is unavailable or its quota is exhausted; publishing has not started.')
  if (reservation.ready) return
  if (reservation.videoSize !== file.size || (file.type && reservation.videoType !== file.type)) {
    throw fail('请选择与原任务大小和格式一致的视频文件', 'Select the original video with the same size and format.')
  }
  const send = async (upload: { url: string; fields: Record<string, string> }, data: Blob) => {
    signal?.throwIfAborted()
    if (!upload || new URL(upload.url).protocol !== 'https:') throw fail('预览上传凭证无效', 'Invalid preview upload credentials.')
    const form = new FormData()
    for (const [name, value] of Object.entries(upload.fields)) form.append(name, value)
    form.append('file', data)
    const timeout = AbortSignal.timeout(14 * 60_000)
    const response = await fetch(upload.url, { method: 'POST', body: form, credentials: 'omit', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (!response.ok) throw fail('预览副本上传失败', 'Preview upload failed.')
  }
  // A lost upload response can still have committed the immutable object.
  // Authoritative HEAD checks decide readiness, never a blind overwrite.
  await Promise.allSettled([send(reservation.video, file), send(reservation.poster, poster)])
  signal?.throwIfAborted()
  const finalized = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    body: JSON.stringify({ action: 'finalize', uploadId: reservation.uploadId }),
  })
  const result = await finalized.json().catch(() => null)
  signal?.throwIfAborted()
  if (!finalized.ok || !result?.ready) throw fail('预览副本未保存完成，请重试；尚未开始 TikTok 发布', 'Preview saving is not confirmed. Retry; TikTok publishing has not started.')
}
