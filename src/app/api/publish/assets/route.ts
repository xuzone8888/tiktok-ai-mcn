import { NextResponse } from 'next/server'

import { getPublicUrl } from '@/lib/oss'
import {
  buildPublishAssetCursorFilter,
  decodePublishAssetCursor,
  encodePublishAssetCursor,
} from '@/lib/publish/asset-page-cursor'
import { PUBLISH_ASSET_PAGE_SIZE } from '@/lib/publish/asset-pagination'
import { createClient } from '@/lib/supabase/server'

const ASSET_FIELDS = [
  'id',
  'type',
  'source',
  'result_url',
  'video_url',
  'thumbnail_url',
  'output_oss_key',
  'prompt',
  'model',
  'created_at',
].join(', ')

interface GenerationAssetRow {
  id: string
  type: 'video'
  source: string | null
  result_url: string | null
  video_url: string | null
  thumbnail_url: string | null
  output_oss_key: string | null
  prompt: string | null
  model: string | null
  created_at: string
}

function toBrowserVideoUrl(row: GenerationAssetRow) {
  let resultUrl =
    row.result_url ||
    row.video_url ||
    (row.output_oss_key ? getPublicUrl(row.output_oss_key) : null)

  if (resultUrl?.includes('60.205.120.27') && resultUrl.includes('/v1/videos/')) {
    resultUrl = `/api/download-proxy?url=${encodeURIComponent(resultUrl)}&filename=video.mp4`
  }
  return resultUrl
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const cursorToken = new URL(request.url).searchParams.get('cursor')
  let cursor = null
  if (cursorToken) {
    try {
      cursor = decodePublishAssetCursor(cursorToken)
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid pagination cursor' },
        { status: 400 }
      )
    }
  }

  let query = supabase
    .from('generations')
    .select(ASSET_FIELDS)
    .eq('user_id', user.id)
    .eq('type', 'video')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PUBLISH_ASSET_PAGE_SIZE + 1)

  if (cursor) {
    query = query.or(buildPublishAssetCursorFilter(cursor))
  }

  const { data, error } = await query
  if (error) {
    console.error('[Publish assets] Failed to load assets:', error.code)
    return NextResponse.json(
      { success: false, error: 'Unable to load creation workspace videos' },
      { status: 500 }
    )
  }

  const rows = (data || []) as unknown as GenerationAssetRow[]
  const hasMore = rows.length > PUBLISH_ASSET_PAGE_SIZE
  const pageRows = rows.slice(0, PUBLISH_ASSET_PAGE_SIZE)
  const lastRow = pageRows.at(-1)
  const nextCursor = hasMore && lastRow
    ? encodePublishAssetCursor({ createdAt: lastRow.created_at, id: lastRow.id })
    : null

  const assets = pageRows.map((row) => ({
    id: row.id,
    type: row.type,
    resultUrl: toBrowserVideoUrl(row),
    thumbnailUrl: row.thumbnail_url,
    prompt: row.prompt,
    model: row.model || 'unknown',
    createdAt: row.created_at,
    source: row.source || 'quick_gen',
  }))

  return NextResponse.json(
    {
      success: true,
      data: {
        assets,
        nextCursor,
        hasMore,
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}
