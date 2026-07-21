export type CommentTranslationLanguage = 'zh' | 'en'
export type CommentTranslationStatus = 'translated' | 'same_language'

export interface CommentTranslationResult {
  comment_id: string
  target_language: CommentTranslationLanguage
  detected_source_language: string | null
  translated_text: string | null
  status: CommentTranslationStatus
}

export function isCommentTranslationLanguage(value: unknown): value is CommentTranslationLanguage {
  return value === 'zh' || value === 'en'
}

export function canonicalizeLanguage(value: string | null | undefined): CommentTranslationLanguage | null {
  const normalized = String(value || '').trim().toLowerCase().replace('_', '-')
  if (!normalized) return null
  if (normalized === 'zh' || normalized.startsWith('zh-') || normalized.includes('chinese') || normalized.includes('mandarin')) return 'zh'
  if (normalized === 'en' || normalized.startsWith('en-') || normalized.includes('english')) return 'en'
  return null
}

export function normalizeTranslationText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

export function resolveTranslationStatus(
  sourceText: string,
  translatedText: string,
  _detectedSourceLanguage: string | null,
  _targetLanguage: CommentTranslationLanguage
): CommentTranslationStatus {
  return normalizeTranslationText(sourceText) === normalizeTranslationText(translatedText)
    ? 'same_language'
    : 'translated'
}

export function chunkTranslationIds(ids: string[], size = 30): string[][] {
  const unique = [...new Set(ids.filter(Boolean))]
  const chunks: string[][] = []
  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size))
  }
  return chunks
}
