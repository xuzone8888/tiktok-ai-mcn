export type PublishAdapterPlatform = 'facebook' | 'instagram' | 'youtube' | 'tiktok'
export type CommonPublishMode = 'now' | 'scheduled'

export interface CommonPublishVideo {
  id: string
  name: string
  url?: string
  title?: string
  description?: string
}

export interface CommonPublishInput {
  title: string
  description: string
  videos: CommonPublishVideo[]
  account_ids: string[]
  publish_mode: CommonPublishMode
  scheduled_at: string | null
  tags?: string[]
  platform_settings?: {
    content_category?: string | null
    published?: boolean
    privacy_status?: string | null
  }
}

export interface FacebookPublishAdapterItem {
  video_id: string
  video_name: string
  video_url?: string
  title: string
  description: string
  content_category: string
  published: boolean
}

export interface InstagramPublishAdapterItem {
  video_id: string
  video_name: string
  video_url?: string
  media_type: 'REELS'
  caption: string
}

export interface FacebookPublishAdapterPayload {
  platform: 'facebook'
  account_ids: string[]
  publish_mode: CommonPublishMode
  scheduled_at: string | null
  items: FacebookPublishAdapterItem[]
}

export interface InstagramPublishAdapterPayload {
  platform: 'instagram'
  account_ids: string[]
  publish_mode: CommonPublishMode
  scheduled_at: string | null
  items: InstagramPublishAdapterItem[]
}

export type PlatformPublishAdapterPayload =
  | FacebookPublishAdapterPayload
  | InstagramPublishAdapterPayload

function stripVideoExtension(name: string) {
  return name
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getDefaultVideoTitle(name: string) {
  return stripVideoExtension(name) || 'Untitled video'
}

function normalizeTags(tags: string[] | undefined) {
  return (tags || [])
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 30)
}

function formatTags(tags: string[]) {
  return tags.map((tag) => `#${tag}`).join(' ')
}

function appendTagsToText(text: string, tags: string[]) {
  return [text.trim(), formatTags(tags)].filter(Boolean).join('\n\n')
}

function resolveTitle(input: CommonPublishInput, video: CommonPublishVideo) {
  return (video.title?.trim() || input.title.trim() || getDefaultVideoTitle(video.name))
}

function resolveDescription(input: CommonPublishInput, video: CommonPublishVideo) {
  return video.description?.trim() || input.description.trim()
}

export function buildPlatformPublishPayload(
  platform: 'facebook',
  commonInput: CommonPublishInput
): FacebookPublishAdapterPayload
export function buildPlatformPublishPayload(
  platform: 'instagram',
  commonInput: CommonPublishInput
): InstagramPublishAdapterPayload
export function buildPlatformPublishPayload(
  platform: PublishAdapterPlatform,
  commonInput: CommonPublishInput
): PlatformPublishAdapterPayload {
  const tags = normalizeTags(commonInput.tags)

  if (platform === 'facebook') {
    const contentCategory = commonInput.platform_settings?.content_category || 'OTHER'
    const published = commonInput.platform_settings?.published ?? true

    return {
      platform,
      account_ids: commonInput.account_ids,
      publish_mode: commonInput.publish_mode,
      scheduled_at: commonInput.scheduled_at,
      items: commonInput.videos.map((video) => ({
        video_id: video.id,
        video_name: video.name,
        video_url: video.url,
        title: resolveTitle(commonInput, video),
        description: appendTagsToText(resolveDescription(commonInput, video), tags),
        content_category: contentCategory,
        published,
      })),
    }
  }

  if (platform === 'instagram') {
    return {
      platform,
      account_ids: commonInput.account_ids,
      publish_mode: commonInput.publish_mode,
      scheduled_at: commonInput.scheduled_at,
      items: commonInput.videos.map((video) => {
        const title = resolveTitle(commonInput, video)
        const description = resolveDescription(commonInput, video)
        return {
          video_id: video.id,
          video_name: video.name,
          video_url: video.url,
          media_type: 'REELS',
          caption: [title, appendTagsToText(description, tags)].filter(Boolean).join('\n\n'),
        }
      }),
    }
  }

  throw new Error(`${platform} publish adapter is not implemented`)
}
