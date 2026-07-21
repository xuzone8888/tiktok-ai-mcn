import { createHash, randomUUID } from 'node:crypto'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  normalizeTranslationText,
  resolveTranslationStatus,
  type CommentTranslationLanguage,
  type CommentTranslationResult,
} from '@/lib/social-comments/translation-core'
import {
  createConfiguredCommentTranslationProvider,
  type CommentTranslationProvider,
} from '@/lib/social-comments/translation-provider'

const MAX_PROVIDER_BATCH_ITEMS = 20
const MAX_PROVIDER_BATCH_CHARACTERS = 12_000
const DISTRIBUTED_WAIT_TIMEOUT_MS = 50_000
const DISTRIBUTED_WAIT_INTERVAL_MS = 300

interface CommentRow {
  id: string
  message: string
}

interface TranslationRow {
  comment_id: string
  target_language: CommentTranslationLanguage
  source_message_hash: string
  detected_source_language: string | null
  translated_text: string | null
  status: 'processing' | 'translated' | 'same_language' | 'failed'
}

interface TranslationDeferred {
  promise: Promise<CommentTranslationResult>
  resolve: (value: CommentTranslationResult) => void
  reject: (reason: unknown) => void
}

const inFlightTranslations = new Map<string, Promise<CommentTranslationResult>>()

function createDeferred(): TranslationDeferred {
  let resolve!: (value: CommentTranslationResult) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<CommentTranslationResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function hashMessage(message: string): string {
  return createHash('sha256').update(message, 'utf8').digest('hex')
}

function createProviderBatches(rows: CommentRow[]): CommentRow[][] {
  const batches: CommentRow[][] = []
  let current: CommentRow[] = []
  let characters = 0
  for (const row of rows) {
    if (current.length > 0 && (current.length >= MAX_PROVIDER_BATCH_ITEMS || characters + row.message.length > MAX_PROVIDER_BATCH_CHARACTERS)) {
      batches.push(current)
      current = []
      characters = 0
    }
    current.push(row)
    characters += row.message.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function mapTranslationRow(row: TranslationRow): CommentTranslationResult {
  if (row.status !== 'translated' && row.status !== 'same_language') {
    throw new Error('Translation cache entry is not complete.')
  }
  return {
    comment_id: row.comment_id,
    target_language: row.target_language,
    detected_source_language: row.detected_source_language,
    translated_text: row.status === 'translated' ? row.translated_text : null,
    status: row.status,
  }
}

function isCompleteTranslation(row: TranslationRow | undefined): row is TranslationRow & { status: 'translated' | 'same_language' } {
  return row?.status === 'translated' || row?.status === 'same_language'
}

async function waitForDistributedTranslation(
  admin: any,
  userId: string,
  commentId: string,
  targetLanguage: CommentTranslationLanguage,
  sourceMessageHash: string
): Promise<CommentTranslationResult> {
  const deadline = Date.now() + DISTRIBUTED_WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const { data, error } = await admin
      .from('social_comment_translations')
      .select('comment_id,target_language,source_message_hash,detected_source_language,translated_text,status')
      .eq('user_id', userId)
      .eq('comment_id', commentId)
      .eq('target_language', targetLanguage)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const row = data as TranslationRow | null
    if (row?.source_message_hash === sourceMessageHash && isCompleteTranslation(row)) return mapTranslationRow(row)
    if (row?.source_message_hash === sourceMessageHash && row.status === 'failed') {
      throw new Error('Comment translation failed.')
    }
    await new Promise((resolve) => setTimeout(resolve, DISTRIBUTED_WAIT_INTERVAL_MS))
  }
  throw new Error('Comment translation timed out while waiting for another worker.')
}

export async function getOrCreateCommentTranslations(
  userId: string,
  commentIds: string[],
  targetLanguage: CommentTranslationLanguage,
  provider?: CommentTranslationProvider
): Promise<CommentTranslationResult[]> {
  const admin = createAdminClient() as any
  const uniqueIds = [...new Set(commentIds)]
  const { data: commentData, error: commentError } = await admin
    .from('social_comments')
    .select('id,message')
    .eq('user_id', userId)
    .in('id', uniqueIds)

  if (commentError) throw new Error(commentError.message)
  const comments = (commentData || []) as CommentRow[]
  if (comments.length !== uniqueIds.length) throw new Error('One or more comments were not found.')

  const { data: cachedData, error: cachedError } = await admin
    .from('social_comment_translations')
    .select('comment_id,target_language,source_message_hash,detected_source_language,translated_text,status')
    .eq('user_id', userId)
    .eq('target_language', targetLanguage)
    .in('comment_id', uniqueIds)

  if (cachedError) throw new Error(cachedError.message)
  const cachedById = new Map<string, TranslationRow>(
    ((cachedData || []) as TranslationRow[]).map((row) => [row.comment_id, row])
  )
  const hashes = new Map(comments.map((comment) => [comment.id, hashMessage(comment.message)]))
  const results = new Map<string, CommentTranslationResult>()
  const misses: CommentRow[] = []

  for (const comment of comments) {
    const cached = cachedById.get(comment.id)
    if (cached && cached.source_message_hash === hashes.get(comment.id) && isCompleteTranslation(cached)) {
      results.set(comment.id, mapTranslationRow(cached))
    } else {
      misses.push(comment)
    }
  }

  if (misses.length > 0) {
    const owned: Array<{ row: CommentRow; key: string; deferred: TranslationDeferred }> = []
    const waiting: Array<{ commentId: string; promise: Promise<CommentTranslationResult> }> = []
    const distributedCandidates: Array<{ row: CommentRow; key: string }> = []
    for (const row of misses) {
      const key = `${userId}:${targetLanguage}:${row.id}:${hashes.get(row.id)}`
      const existing = inFlightTranslations.get(key)
      if (existing) {
        waiting.push({ commentId: row.id, promise: existing })
        continue
      }
      distributedCandidates.push({ row, key })
    }

    let activeProvider: CommentTranslationProvider | null = null
    const leaseToken = randomUUID()
    if (distributedCandidates.length > 0) {
      activeProvider = provider || createConfiguredCommentTranslationProvider()
      const { data: claimData, error: claimError } = await admin.rpc('claim_social_comment_translations', {
        p_user_id: userId,
        p_target_language: targetLanguage,
        p_provider: activeProvider.name,
        p_model: activeProvider.model,
        p_lease_token: leaseToken,
        p_claims: distributedCandidates.map(({ row }) => ({
          comment_id: row.id,
          source_message_hash: hashes.get(row.id),
        })),
      })
      if (claimError) throw new Error(claimError.message)
      const claimedIds = new Set((claimData || []).map((item: { comment_id: string }) => item.comment_id))
      for (const candidate of distributedCandidates) {
        if (claimedIds.has(candidate.row.id)) {
          const deferred = createDeferred()
          inFlightTranslations.set(candidate.key, deferred.promise)
          owned.push({ ...candidate, deferred })
          waiting.push({ commentId: candidate.row.id, promise: deferred.promise })
        } else {
          waiting.push({
            commentId: candidate.row.id,
            promise: waitForDistributedTranslation(
              admin,
              userId,
              candidate.row.id,
              targetLanguage,
              hashes.get(candidate.row.id) as string
            ),
          })
        }
      }
    }

    const processOwned = async () => {
      if (owned.length === 0) return
      try {
        if (!activeProvider) throw new Error('Comment translation provider is unavailable.')
        for (const batch of createProviderBatches(owned.map((item) => item.row))) {
          const { data: renewedData, error: renewedError } = await admin.rpc('renew_social_comment_translation_claims', {
            p_user_id: userId,
            p_target_language: targetLanguage,
            p_lease_token: leaseToken,
            p_comment_ids: batch.map((row) => row.id),
          })
          if (renewedError) throw new Error(renewedError.message)
          const renewedIds = new Set((renewedData || []).map((item: { comment_id: string }) => item.comment_id))
          if (renewedIds.size !== batch.length) throw new Error('Comment translation claim was lost before provider access.')

          const aliases = new Map(batch.map((row, index) => [`c${index}`, row]))
          const translated = await activeProvider.translateBatch(
            [...aliases].map(([id, row]) => ({ id, text: row.message })),
            targetLanguage
          )
          const rows = translated.map((item) => {
            const source = aliases.get(item.id)
            if (!source) throw new Error('Translation provider returned an unknown comment.')
            const translatedText = normalizeTranslationText(item.translated_text)
            const status = resolveTranslationStatus(source.message, translatedText, item.detected_source_language, targetLanguage)
            return {
              comment_id: source.id,
              source_message_hash: hashes.get(source.id) as string,
              detected_source_language: item.detected_source_language,
              translated_text: status === 'translated' ? translatedText : null,
              status,
            }
          })

          const { data: savedData, error: saveError } = await admin.rpc('complete_social_comment_translations', {
            p_user_id: userId,
            p_target_language: targetLanguage,
            p_lease_token: leaseToken,
            p_results: rows,
          })
          if (saveError) throw new Error(saveError.message)
          const savedIds = new Set((savedData || []).map((item: { comment_id: string }) => item.comment_id))
          for (const source of batch) {
            const row = rows.find((item) => item.comment_id === source.id)
            const claim = owned.find((item) => item.row.id === source.id)
            if (!row || !claim || !savedIds.has(source.id)) throw new Error('Comment translation claim was lost before persistence.')
            claim.deferred.resolve(mapTranslationRow({
              ...row,
              target_language: targetLanguage,
            }))
          }
        }
      } catch (error) {
        if (owned.length > 0) {
          await admin.rpc('fail_social_comment_translation_claims', {
            p_user_id: userId,
            p_target_language: targetLanguage,
            p_lease_token: leaseToken,
            p_comment_ids: owned.map((claim) => claim.row.id),
          })
        }
        for (const claim of owned) claim.deferred.reject(error)
        throw error
      } finally {
        for (const claim of owned) {
          if (inFlightTranslations.get(claim.key) === claim.deferred.promise) inFlightTranslations.delete(claim.key)
        }
      }
    }

    const [settled] = await Promise.all([
      Promise.all(waiting.map(async ({ commentId, promise }) => ({ commentId, result: await promise }))),
      processOwned(),
    ])
    for (const item of settled) results.set(item.commentId, item.result)
  }

  return uniqueIds.map((id) => results.get(id)).filter((item): item is CommentTranslationResult => Boolean(item))
}
