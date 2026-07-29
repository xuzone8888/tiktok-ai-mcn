export const PUBLISH_ASSET_PAGE_SIZE = 50

export interface PublishAssetPage<TAsset> {
  assets: TAsset[]
  nextCursor: string | null
  hasMore: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function buildPublishAssetPageUrl(cursor: string | null = null) {
  if (!cursor) return '/api/publish/assets'

  const params = new URLSearchParams({ cursor })
  return `/api/publish/assets?${params.toString()}`
}

export function parsePublishAssetPage<TAsset extends { id: string }>(
  payload: unknown,
  requestedCursor: string | null = null
): PublishAssetPage<TAsset> {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
    throw new Error('Invalid asset page response')
  }

  const { assets, nextCursor, hasMore } = payload.data
  if (
    !Array.isArray(assets) ||
    !assets.every((asset) => isRecord(asset) && typeof asset.id === 'string' && asset.id.length > 0) ||
    (nextCursor !== null && typeof nextCursor !== 'string') ||
    typeof hasMore !== 'boolean' ||
    (hasMore && (typeof nextCursor !== 'string' || nextCursor.length === 0)) ||
    (hasMore && nextCursor === requestedCursor)
  ) {
    throw new Error('Invalid asset page response')
  }

  return {
    assets: assets as TAsset[],
    nextCursor,
    hasMore,
  }
}

export function mergePublishAssetPages<TAsset extends { id: string }>(
  current: readonly TAsset[],
  incoming: readonly TAsset[]
) {
  const knownIds = new Set(current.map((asset) => asset.id))
  const merged = [...current]

  for (const asset of incoming) {
    if (knownIds.has(asset.id)) continue
    knownIds.add(asset.id)
    merged.push(asset)
  }

  return merged
}
