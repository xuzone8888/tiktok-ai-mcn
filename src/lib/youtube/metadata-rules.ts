export const YOUTUBE_TITLE_MAX_CHARACTERS = 100
export const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000
export const YOUTUBE_TAGS_MAX_CHARACTERS = 500
export const YOUTUBE_OFFICIAL_MAX_FILE_SIZE_BYTES = 256 * 1024 * 1024 * 1024

const DISALLOWED_METADATA_CHARS = /[<>]/

export function getYouTubeCharacterLength(value: string) {
  return Array.from(value).length
}

export function getUtf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length
}

export function hasYouTubeDisallowedMetadataChars(value: string) {
  return DISALLOWED_METADATA_CHARS.test(value)
}

export function stripYouTubeDisallowedMetadataChars(value: string) {
  return value.replace(/[<>]/g, '')
}

export function truncateYouTubeTextByCharacters(value: string, maxCharacters: number) {
  return Array.from(value).slice(0, maxCharacters).join('')
}

export function truncateYouTubeTextByUtf8Bytes(value: string, maxBytes: number) {
  let bytes = 0
  let result = ''

  for (const char of Array.from(value)) {
    const charBytes = getUtf8ByteLength(char)
    if (bytes + charBytes > maxBytes) break
    result += char
    bytes += charBytes
  }

  return result
}

export function getYouTubeTagsCharacterCount(tags: string[]) {
  const normalizedTags = tags.map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean)
  return normalizedTags.reduce((total, tag, index) => {
    const tagCharacters = getYouTubeCharacterLength(tag)
    const quotedSpaceCharacters = /\s/.test(tag) ? 2 : 0
    const commaCharacter = index > 0 ? 1 : 0
    return total + tagCharacters + quotedSpaceCharacters + commaCharacter
  }, 0)
}

export function validateYouTubeTitle(value: string, label = '视频标题') {
  const title = value.trim()
  if (!title) return `${label}不能为空`
  if (hasYouTubeDisallowedMetadataChars(title)) return `${label}不能包含 < 或 >`
  if (getYouTubeCharacterLength(title) > YOUTUBE_TITLE_MAX_CHARACTERS) {
    return `${label}不能超过 ${YOUTUBE_TITLE_MAX_CHARACTERS} 个字符`
  }
  return null
}

export function validateYouTubeDescription(value: string, label = '视频描述') {
  if (hasYouTubeDisallowedMetadataChars(value)) return `${label}不能包含 < 或 >`
  if (getUtf8ByteLength(value) > YOUTUBE_DESCRIPTION_MAX_BYTES) {
    return `${label}不能超过 ${YOUTUBE_DESCRIPTION_MAX_BYTES} bytes`
  }
  return null
}

export function validateYouTubeTags(tags: string[]) {
  const normalizedTags = tags.map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean)
  const invalidTag = normalizedTags.find(hasYouTubeDisallowedMetadataChars)
  if (invalidTag) return `标签不能包含 < 或 >：${invalidTag}`

  const tagsCharacters = getYouTubeTagsCharacterCount(normalizedTags)
  if (tagsCharacters > YOUTUBE_TAGS_MAX_CHARACTERS) {
    return `标签总长度不能超过 ${YOUTUBE_TAGS_MAX_CHARACTERS} 个字符`
  }

  return null
}
