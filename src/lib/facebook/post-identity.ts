import { getFacebookAppSecretProof } from '@/lib/facebook/oauth'
import { callBroker, isBrokerEnabled } from '@/lib/oauth-broker/client'

export interface FacebookVideoPostIdentity {
  postId: string | null
  permalinkUrl: string | null
}

const GRAPH_URL = `https://graph.facebook.com/${process.env.FACEBOOK_API_VERSION || 'v25.0'}`
const MAX_POST_PAGES = 3

function numericId(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value)
}

function pagePostId(value: unknown, pageId: string): string | null {
  if (numericId(value)) return `${pageId}_${value}`
  return typeof value === 'string' && new RegExp(`^${pageId}_\\d+$`).test(value) ? value : null
}

function permalink(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value, 'https://www.facebook.com')
    if (url.username || url.password || [...url.searchParams.keys()].some(key =>
      /^(access_token|appsecret_proof|token|code|client_secret)$/i.test(key))) return null
    return url.protocol === 'https:' && ['facebook.com', 'www.facebook.com'].includes(url.hostname)
      ? url.toString() : null
  } catch { return null }
}

/** Read-only, bounded identity recovery. Never infer a post from a title, timestamp or comment. */
export async function resolveFacebookVideoPostIdentity(
  accessToken: string,
  pageId: string,
  videoId: string,
  scanPosts = true,
): Promise<FacebookVideoPostIdentity | null> {
  if (!numericId(pageId) || !numericId(videoId) || typeof accessToken !== 'string' || !accessToken) return null
  if (isBrokerEnabled()) {
    return callBroker<FacebookVideoPostIdentity | null>('facebook', 'resolveFacebookVideoPostIdentity', {
      accessToken, pageId, videoId, scanPosts,
    })
  }

  // Covers the complete lookup, not each page individually. No response body/credential logging.
  const signal = AbortSignal.timeout(12_000)
  async function read(path: string, fields: string, after?: string): Promise<any> {
    if (signal.aborted) return null
    const url = new URL(`${GRAPH_URL}/${path}`)
    url.searchParams.set('fields', fields)
    url.searchParams.set('appsecret_proof', getFacebookAppSecretProof(accessToken))
    if (path.endsWith('/published_posts')) url.searchParams.set('limit', '50')
    if (after) url.searchParams.set('after', after)
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal })
      return response.ok ? await response.json() : null
    } catch { return null }
  }

  let video = await read(videoId, 'id,post_id,permalink_url')
  // An optional field must not prevent reading the identity itself.
  if (!video) video = await read(videoId, 'id,post_id')
  const url = video?.id === videoId ? permalink(video.permalink_url) : null
  const directId = video?.id === videoId ? pagePostId(video.post_id, pageId) : null
  if (directId) return { postId: directId, permalinkUrl: url }
  if (!scanPosts) return url ? { postId: null, permalinkUrl: url } : null

  const cursors = new Set<string>()
  const checkedPosts = new Set<string>()
  let after: string | undefined
  for (let page = 0; page < MAX_POST_PAGES; page += 1) {
    const result = await read(`${pageId}/published_posts`, 'id,object_id,permalink_url,attachments{target{id}}', after)
    if (!Array.isArray(result?.data)) break
    for (const post of result.data) {
      const id = pagePostId(post?.id, pageId)
      const attachments = Array.isArray(post?.attachments?.data) ? post.attachments.data : []
      const isVideo = post?.object_id === videoId || attachments.some((item: any) => item?.target?.id === videoId)
      if (!id || !isVideo || checkedPosts.has(id)) continue
      checkedPosts.add(id)
      // A scan hit alone may be a re-share. Verify the original published video post
      // directly instead of requiring every historical Page post to fit in the scan.
      const verified = await read(id, 'id,object_id,from{id},status_type,is_published,permalink_url')
      if (verified?.id === id && verified.object_id === videoId
        && verified.from?.id === pageId && verified.status_type === 'added_video'
        && verified.is_published === true) {
        return { postId: id, permalinkUrl: permalink(verified.permalink_url) || url }
      }
    }
    if (!result.paging?.next) break
    const cursor = result.paging?.cursors?.after
    if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) break
    cursors.add(cursor)
    after = cursor // Rebuild a fixed-host URL; never fetch a provider-supplied next URL.
  }
  // No verified original in this bounded scan. Leave recovery for a later attempt.
  return url ? { postId: null, permalinkUrl: url } : null
}
