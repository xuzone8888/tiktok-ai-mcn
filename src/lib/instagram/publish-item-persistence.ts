import { buildInstagramFailedItemUpdate } from '@/lib/instagram/publish-state'

export async function updateInstagramItemWithRetry(
  supabase: any,
  itemId: string,
  leaseToken: string,
  update: Record<string, unknown>,
  expectedStatus: 'uploading' | 'container_created' | 'published',
  maxAttempts = 2
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await supabase
      .from('instagram_publish_task_items')
      .update(update)
      .eq('id', itemId)
      .eq('status', expectedStatus)
      .eq('processing_started_at', leaseToken)
      .select('id')
      .maybeSingle()
    if (!error && data) return true
  }
  return false
}

export function persistInstagramFailedItem(
  supabase: any,
  itemId: string,
  leaseToken: string,
  message: string,
  code: string,
  containerId: string | undefined,
  expectedStatus: 'uploading' | 'container_created' | 'published'
) {
  return updateInstagramItemWithRetry(
    supabase,
    itemId,
    leaseToken,
    buildInstagramFailedItemUpdate(message, code, new Date().toISOString(), containerId),
    expectedStatus
  )
}
