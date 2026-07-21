import { buildInstagramReconciliationUpdate } from '@/lib/instagram/publish-state'

export async function persistInstagramReconciliationState(
  supabase: any,
  itemId: string,
  leaseToken: string,
  expectedStatus: 'uploading' | 'container_created',
  knownId: string,
  updatedAt: string,
  maxAttempts = 2
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await supabase
      .from('instagram_publish_task_items')
      .update(buildInstagramReconciliationUpdate(knownId, updatedAt))
      .eq('id', itemId)
      .eq('status', expectedStatus)
      .eq('processing_started_at', leaseToken)
      .select('id')
      .maybeSingle()
    if (!error && data) return true
  }
  return false
}
