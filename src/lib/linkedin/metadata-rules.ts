export const LINKEDIN_TITLE_MAX_CHARACTERS = 200
export const LINKEDIN_DESCRIPTION_MAX_CHARACTERS = 3000
export const LINKEDIN_TAGS_MAX_CHARACTERS = 500
export const LINKEDIN_MAX_FILE_SIZE = 200 * 1024 * 1024

const DISALLOWED_METADATA_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/

export function getLinkedInCharacterLength(value: string) {
  return Array.from(value).length
}

export function stripLinkedInDisallowedMetadataChars(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

export function truncateLinkedInText(value: string, maxCharacters: number) {
  return Array.from(value).slice(0, maxCharacters).join('')
}

export function normalizeLinkedInTags(tags: string[] | undefined) {
  return (tags || [])
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 30)
}

export function formatLinkedInTags(tags: string[]) {
  return normalizeLinkedInTags(tags).map((tag) => `#${tag}`).join(' ')
}

export function appendLinkedInTags(text: string, tags: string[]) {
  return [text.trim(), formatLinkedInTags(tags)].filter(Boolean).join('\n\n')
}

export function validateLinkedInTitle(value: string, label = '视频标题') {
  const title = value.trim()
  if (!title) return `${label}不能为空`
  if (DISALLOWED_METADATA_CHARS.test(title)) return `${label}包含不可见控制字符`
  if (getLinkedInCharacterLength(title) > LINKEDIN_TITLE_MAX_CHARACTERS) {
    return `${label}不能超过 ${LINKEDIN_TITLE_MAX_CHARACTERS} 个字符`
  }
  return null
}

export function validateLinkedInDescription(value: string, label = '视频描述') {
  if (DISALLOWED_METADATA_CHARS.test(value)) return `${label}包含不可见控制字符`
  if (getLinkedInCharacterLength(value) > LINKEDIN_DESCRIPTION_MAX_CHARACTERS) {
    return `${label}不能超过 ${LINKEDIN_DESCRIPTION_MAX_CHARACTERS} 个字符`
  }
  return null
}

export function validateLinkedInTags(tags: string[]) {
  const normalizedTags = normalizeLinkedInTags(tags)
  const invalidTag = normalizedTags.find((tag) => DISALLOWED_METADATA_CHARS.test(tag))
  if (invalidTag) return `标签包含不可见控制字符：${invalidTag}`

  const length = getLinkedInCharacterLength(formatLinkedInTags(normalizedTags))
  if (length > LINKEDIN_TAGS_MAX_CHARACTERS) {
    return `标签总长度不能超过 ${LINKEDIN_TAGS_MAX_CHARACTERS} 个字符`
  }

  return null
}
