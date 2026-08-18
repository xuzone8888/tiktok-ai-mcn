import {
  buildInstagramMediaCreateOutcomeUnknownUpdate,
  buildInstagramMediaPublishBarrierUpdate,
  buildInstagramMediaPublishOutcomeUnknownUpdate,
} from '@/lib/instagram/publish-state'

async function updateBarrierState(
  supabase: any,
  itemId: string,
  leaseToken: string,
  expectedStatus: 'uploading' | 'container_created',
  update: Record<string, unknown>
) {
  const { data, error } = await supabase
    .from('instagram_publish_task_items')
    .update(update)
    .eq('id', itemId)
    .eq('status', expectedStatus)
    .eq('processing_started_at', leaseToken)
    .select('id')
    .maybeSingle()
  if (error) {
    throw new Error(`保存 Instagram 发布屏障状态失败: ${error.message}`)
  }
  return Boolean(data)
}

export function enterInstagramMediaPublishBarrier(
  supabase: any,
  itemId: string,
  leaseToken: string,
  containerId: string,
  updatedAt: string
) {
  return updateBarrierState(
    supabase,
    itemId,
    leaseToken,
    'uploading',
    buildInstagramMediaPublishBarrierUpdate(containerId, updatedAt)
  )
}

export function persistInstagramMediaPublishOutcomeUnknown(
  supabase: any,
  itemId: string,
  leaseToken: string,
  containerId: string,
  updatedAt: string
) {
  return updateBarrierState(
    supabase,
    itemId,
    leaseToken,
    'container_created',
    buildInstagramMediaPublishOutcomeUnknownUpdate(containerId, updatedAt)
  )
}

export function persistInstagramMediaCreateOutcomeUnknown(
  supabase: any,
  itemId: string,
  leaseToken: string,
  updatedAt: string
) {
  return updateBarrierState(
    supabase,
    itemId,
    leaseToken,
    'uploading',
    buildInstagramMediaCreateOutcomeUnknownUpdate(updatedAt)
  )
}
