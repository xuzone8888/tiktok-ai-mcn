import { isYouTubeAuthorizationRevokedError, revokeYouTubeToken } from '@/lib/youtube/oauth'

type RevocationResult = {
  attempted: number
  completed: number
  deferred: number
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('timeout') || message.includes('abort')) return 'timeout'
  if (message.includes('429') || message.includes('rate')) return 'rate_limited'
  if (message.includes('401') || message.includes('403')) return 'rejected'
  return 'temporary_failure'
}

export async function processYouTubeRevocationJobs(
  admin: any,
  options: { jobId?: string; limit?: number } = {},
): Promise<RevocationResult> {
  const now = new Date()
  let query = admin
    .from('youtube_revocation_jobs')
    .select('id, refresh_token, attempts, expires_at, last_error_code')
    .gt('expires_at', now.toISOString())
    .lte('next_attempt_at', now.toISOString())
    .order('created_at', { ascending: true })
    .limit(options.limit || 25)

  if (options.jobId) query = query.eq('id', options.jobId)

  const { data: jobs, error: jobsError } = await query
  if (jobsError) {
    throw new Error(`Unable to read YouTube revocation queue: ${jobsError.message}`)
  }

  const result: RevocationResult = { attempted: 0, completed: 0, deferred: 0 }
  for (const job of jobs || []) {
    const claimedAt = new Date().toISOString()
    const staleClaim = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { data: claimed, error: claimError } = await admin
      .from('youtube_revocation_jobs')
      .update({ claimed_at: claimedAt, updated_at: claimedAt })
      .eq('id', job.id)
      .or(`claimed_at.is.null,claimed_at.lt.${staleClaim}`)
      .select('id')
      .maybeSingle()
    if (claimError) throw new Error(`Unable to claim YouTube revocation job: ${claimError.message}`)
    if (!claimed) continue

    result.attempted += 1
    let revocationComplete = job.last_error_code === 'revoked'
    try {
      if (!revocationComplete) {
        await revokeYouTubeToken(job.refresh_token)
        const { error: markerError } = await admin
          .from('youtube_revocation_jobs')
          .update({ last_error_code: 'revoked', updated_at: new Date().toISOString() })
          .eq('id', job.id)
        if (markerError) throw new Error(`Unable to record completed token revocation: ${markerError.message}`)
        revocationComplete = true
      }
    } catch (error) {
      if (isYouTubeAuthorizationRevokedError(error)) {
        const { error: markerError } = await admin
          .from('youtube_revocation_jobs')
          .update({ last_error_code: 'revoked', updated_at: new Date().toISOString() })
          .eq('id', job.id)
        if (markerError) throw new Error(`Unable to record terminal token revocation: ${markerError.message}`)
        revocationComplete = true
      } else {
        const attempts = Number(job.attempts || 0) + 1
        const delayHours = Math.min(24, 2 ** Math.min(attempts, 5))
        const nextAttemptAt = new Date(Date.now() + delayHours * 60 * 60 * 1000)
        const expiresAt = new Date(job.expires_at)
        const { error: updateError } = await admin
          .from('youtube_revocation_jobs')
          .update({
            attempts,
            claimed_at: null,
            next_attempt_at: new Date(Math.min(nextAttemptAt.getTime(), expiresAt.getTime())).toISOString(),
            last_error_code: safeErrorCode(error),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
        if (updateError) {
          throw new Error(`Unable to defer YouTube revocation job: ${updateError.message}`)
        }
        result.deferred += 1
      }
    }

    if (revocationComplete) {
      const { error: deleteError } = await admin
        .from('youtube_revocation_jobs')
        .delete()
        .eq('id', job.id)
      if (deleteError) throw new Error(`Unable to delete completed revocation job: ${deleteError.message}`)
      result.completed += 1
    }
  }

  return result
}

export async function markYouTubeAuthorizationInvalid(
  admin: any,
  userId: string,
  accountId: string,
) {
  const { error } = await admin.rpc('mark_youtube_authorization_invalid', {
    p_user_id: userId,
    p_account_id: accountId,
  })
  if (error) {
    throw new Error(`Unable to record invalid YouTube authorization: ${error.message}`)
  }
}
