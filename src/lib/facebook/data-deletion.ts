import crypto from 'crypto'

import { createAdminClient } from '@/lib/supabase/admin'

export interface FacebookDeletionResult {
  confirmationCode: string
  deletion: Record<string, unknown>
}

export async function deleteFacebookAuthorizationData(
  facebookUserId: string,
): Promise<FacebookDeletionResult> {
  const admin = createAdminClient() as any
  const confirmationCode = crypto.randomBytes(18).toString('base64url')

  const { error: requestError } = await admin
    .from('facebook_data_deletion_requests')
    .insert({
      confirmation_code: confirmationCode,
      status: 'processing',
    })
  if (requestError) {
    throw new Error('facebook_deletion_request_persistence_failed')
  }

  const { data: deletion, error: deletionError } = await admin.rpc(
    'delete_facebook_authorization_data',
    { p_facebook_user_id: facebookUserId },
  )
  if (deletionError) {
    await admin
      .from('facebook_data_deletion_requests')
      .update({
        status: 'failed',
        result: { code: deletionError.code || 'deletion_failed' },
        completed_at: new Date().toISOString(),
      })
      .eq('confirmation_code', confirmationCode)
    throw new Error('facebook_authorization_data_deletion_failed')
  }

  const safeDeletion = deletion && typeof deletion === 'object' ? deletion : {}
  const { error: completionError } = await admin
    .from('facebook_data_deletion_requests')
    .update({
      status: 'completed',
      result: safeDeletion,
      completed_at: new Date().toISOString(),
    })
    .eq('confirmation_code', confirmationCode)
  if (completionError) {
    throw new Error('facebook_deletion_completion_persistence_failed')
  }

  return {
    confirmationCode,
    deletion: safeDeletion,
  }
}
