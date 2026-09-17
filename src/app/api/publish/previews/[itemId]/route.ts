import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { previewStorage } from '@/lib/publish/private-preview-storage'
import { PREVIEW_POSTER_MAX, previewRange } from '@/lib/publish/private-preview-contract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ itemId: string }> }
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: privateHeaders })

async function smallJson(request: NextRequest) {
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2048) { await reader.cancel(); return null }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch { return null } finally { reader.releaseLock() }
}

async function authorize(itemId: string) {
  const db = await createClient()
  const { data: { user }, error } = await db.auth.getUser()
  if (error || !user) return { response: fail('请先登录', 401) }
  // Check ownership with user-scoped client BEFORE accessing privileged storage.
  const { data: item, error: itemError } = await db.from('publish_task_items')
    .select('id, tiktok_transfer_method, source_video_size_bytes, source_video_mime_type, publish_tasks!inner(user_id)')
    .eq('id', itemId).eq('publish_tasks.user_id', user.id).maybeSingle()
  if (itemError) return { response: fail('无法确认任务权限', 503) }
  if (!item || item.tiktok_transfer_method !== 'FILE_UPLOAD') return { response: fail('任务不存在', 404) }
  return { user, item }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    // Same-origin only: these requests mint write capabilities.
    const appOrigin = process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin : request.nextUrl.origin
    if (request.headers.get('origin') !== appOrigin) return fail('请求来源无效', 403)
    const { itemId } = await context.params
    const auth = await authorize(itemId)
    if (auth.response) return auth.response
    if (Number(request.headers.get('content-length') || 0) > 2048) return fail('请求过大', 413)
    const body = await smallJson(request)
    if (!body || !['reserve', 'finalize'].includes(body.action)) return fail('请求无效', 400)
    if (body.action === 'reserve' && (
      !Number.isSafeInteger(body.videoSize) || body.videoSize !== auth.item.source_video_size_bytes
      || typeof body.videoType !== 'string'
      || (body.videoType && body.videoType !== auth.item.source_video_mime_type)
    )) return fail('请选择原任务的视频文件', 400)
    const admin = createAdminClient()
    const storage = previewStorage()
    await storage.assertPrivate()
    if (body.action === 'reserve') {
      if (!Number.isInteger(body.posterSize) || body.posterSize < 1 || body.posterSize > PREVIEW_POSTER_MAX) return fail('封面无效', 400)
      const { data, error } = await admin.rpc('reserve_tiktok_preview', {
        p_user_id: auth.user.id, p_item_id: itemId, p_poster_size: body.posterSize,
      })
      if (error || data?.length !== 1) return fail('预览存储未就绪或配额不足，尚未开始 TikTok 发布', 409)
      const row = data[0]
      if (row.ready) return NextResponse.json({ ready: true }, { headers: privateHeaders })
      return NextResponse.json({
        uploadId: row.upload_id,
        videoSize: row.video_size,
        videoType: row.video_type,
        video: storage.upload(auth.user.id, row.upload_id, 'video', row.video_type, row.video_size, row.expires_at),
        poster: storage.upload(auth.user.id, row.upload_id, 'poster', 'image/jpeg', row.poster_size, row.expires_at),
      }, { headers: privateHeaders })
    }
    if (typeof body.uploadId !== 'string') return fail('上传标识无效', 400)
    const { data: row, error } = await admin.from('tiktok_task_previews').select('*')
      .eq('item_id', itemId).eq('owner_id', auth.user.id).eq('upload_id', body.uploadId).maybeSingle()
    if (error) return fail('预览状态读取失败', 503)
    if (!row) return fail('上传已失效', 409)
    if (!row.ready) {
      if (Date.parse(row.expires_at) <= Date.now()) return fail('预览上传超时，请重新选择文件', 409)
      await Promise.all([
        storage.verify(auth.user.id, row.upload_id, 'video', row.video_type, row.video_size),
        storage.verify(auth.user.id, row.upload_id, 'poster', 'image/jpeg', row.poster_size),
      ])
      // CAS: deleted/replaced reservations must never be resurrected, including 0-row writes.
      const { data: saved, error: saveError } = await admin.from('tiktok_task_previews').update({ ready: true })
        .eq('item_id', itemId).eq('owner_id', auth.user.id).eq('upload_id', row.upload_id)
        .gt('expires_at', new Date().toISOString()).select('item_id')
      if (saveError || saved?.length !== 1) return fail('任务已变化，预览未确认', 409)
    }
    return NextResponse.json({ ready: true }, { headers: privateHeaders })
  } catch {
    // Never log SDK errors: they may contain object paths or signed URLs.
    return fail('私有预览暂时不可用，请检查存储配置或上传状态', 503)
  }
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { itemId } = await context.params
    const auth = await authorize(itemId)
    if (auth.response) return auth.response
    const kind = request.nextUrl.searchParams.get('kind') || 'video'
    if (kind !== 'poster' && kind !== 'video') return fail('请求无效', 400)
    const { data: row, error } = await createAdminClient().from('tiktok_task_previews').select('*')
      .eq('item_id', itemId).eq('owner_id', auth.user.id).eq('ready', true).maybeSingle()
    if (error) return fail('预览读取失败', 503)
    if (!row) return fail('暂无保存的预览', 404)
    const size = kind === 'video' ? row.video_size : row.poster_size
    let range
    try { range = previewRange(request.headers.get('range'), size) } catch {
      return new NextResponse(null, { status: 416, headers: { ...privateHeaders, 'Content-Range': `bytes */${size}` } })
    }
    const storage = previewStorage()
    const upstream = await fetch(storage.readUrl(auth.user.id, row.upload_id, kind), {
      cache: 'no-store', redirect: 'error', signal: request.signal,
      headers: range ? { Range: `bytes=${range.start}-${range.end}` } : {},
    })
    const length = range ? range.end - range.start + 1 : size
    if (upstream.status !== (range ? 206 : 200) || Number(upstream.headers.get('content-length')) !== length
      || (range && upstream.headers.get('content-range') !== `bytes ${range.start}-${range.end}/${size}`)) {
      await upstream.body?.cancel()
      return fail('预览加载失败', 502)
    }
    return new NextResponse(upstream.body, { status: range ? 206 : 200, headers: {
      ...privateHeaders, 'Content-Type': kind === 'poster' ? 'image/jpeg' : row.video_type,
      'Content-Length': String(length), 'Accept-Ranges': 'bytes', 'Content-Disposition': 'inline',
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}),
    } })
  } catch { return fail('预览加载失败', 503) }
}
