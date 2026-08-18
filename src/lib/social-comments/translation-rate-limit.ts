import { createAdminClient } from '@/lib/supabase/admin'

export async function consumeCommentTranslationRequest(userId: string): Promise<boolean> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.rpc('consume_social_comment_translation_quota', {
    p_user_id: userId,
    p_window_seconds: 60,
    p_max_requests: 30,
  })
  if (error) throw new Error(error.message)
  return data === true
}
