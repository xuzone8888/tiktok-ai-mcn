export const INSTAGRAM_DEFERRED_REPOLL_DELAY_MS = 15 * 1000
export const INSTAGRAM_INLINE_POLL_INTERVAL_MS = 5 * 1000
export const INSTAGRAM_INLINE_MAX_WAIT_MS = 75 * 1000
// Active work must stay leased longer than the full inline poll plus API/database safety margin.
export const INSTAGRAM_ACTIVE_UPLOAD_LEASE_MS = 3 * 60 * 1000

export interface InstagramPublishLeaseItem {
  id: string
  status: string
  updated_at: string
}

export interface InstagramPublishLease {
  token: string
}

export class InstagramPublishLeaseLostError extends Error {
  constructor() {
    super('Instagram 发布任务租约已失效')
    this.name = 'InstagramPublishLeaseLostError'
  }
}

export function isInstagramPublishItemEligible(item: InstagramPublishLeaseItem, nowMs = Date.now()) {
  if (item.status === 'pending') return true
  if (item.status !== 'processing' && item.status !== 'uploading') return false

  const updatedAt = new Date(item.updated_at).getTime()
  if (!Number.isFinite(updatedAt)) return true
  if (item.status === 'processing') {
    return updatedAt <= nowMs - INSTAGRAM_DEFERRED_REPOLL_DELAY_MS
  }
  if (item.status === 'uploading') {
    return updatedAt <= nowMs - INSTAGRAM_ACTIVE_UPLOAD_LEASE_MS
  }
  return false
}

export function mergeInstagramPublishCandidateQueues<T>(
  queues: readonly (readonly T[])[],
  maxItems: number
): T[] {
  const limit = Math.max(0, Math.floor(maxItems))
  const result: T[] = []
  let offset = 0

  while (result.length < limit) {
    let added = false
    for (const queue of queues) {
      if (offset < queue.length) {
        result.push(queue[offset])
        added = true
        if (result.length === limit) return result
      }
    }
    if (!added) break
    offset++
  }

  return result
}

export async function queryInstagramPublishCandidates<T>(
  supabase: any,
  options: {
    select: string
    taskId?: string
    maxItems: number
    nowMs?: number
  }
): Promise<T[]> {
  const nowMs = options.nowMs ?? Date.now()
  const now = new Date(nowMs).toISOString()
  const maxItems = Math.max(1, Math.floor(options.maxItems))

  async function queryEligibleStatus(
    status: 'pending' | 'processing' | 'uploading',
    updatedBefore?: string
  ) {
    let query = supabase
      .from('instagram_publish_task_items')
      .select(options.select)
      .eq('status', status)
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .order('updated_at', { ascending: true })
      .limit(maxItems)

    if (updatedBefore) query = query.lte('updated_at', updatedBefore)
    if (options.taskId) query = query.eq('task_id', options.taskId)

    const { data, error } = await query
    if (error) {
      throw new Error(`查询 Instagram 发布任务失败: ${error.message}`)
    }
    return (data || []) as T[]
  }

  const [pending, processing, uploading] = await Promise.all([
    queryEligibleStatus('pending'),
    queryEligibleStatus(
      'processing',
      new Date(nowMs - INSTAGRAM_DEFERRED_REPOLL_DELAY_MS).toISOString()
    ),
    queryEligibleStatus(
      'uploading',
      new Date(nowMs - INSTAGRAM_ACTIVE_UPLOAD_LEASE_MS).toISOString()
    ),
  ])

  return mergeInstagramPublishCandidateQueues([pending, processing, uploading], maxItems)
}

export async function claimInstagramPublishItem(
  supabase: any,
  item: InstagramPublishLeaseItem,
  nowMs = Date.now()
): Promise<InstagramPublishLease | null> {
  const now = new Date(nowMs).toISOString()
  let query = supabase
    .from('instagram_publish_task_items')
    .update({
      status: 'uploading',
      processing_started_at: now,
      updated_at: now,
    })
    .eq('id', item.id)
    .eq('status', item.status)

  if (item.status === 'processing') {
    query = query.lte(
      'updated_at',
      new Date(nowMs - INSTAGRAM_DEFERRED_REPOLL_DELAY_MS).toISOString()
    )
  } else if (item.status === 'uploading') {
    query = query.lte(
      'updated_at',
      new Date(nowMs - INSTAGRAM_ACTIVE_UPLOAD_LEASE_MS).toISOString()
    )
  } else if (item.status !== 'pending') {
    return null
  }

  const { data, error } = await query.select('id').maybeSingle()
  if (error) {
    throw new Error(`锁定 Instagram 发布任务失败: ${error.message}`)
  }
  return data ? { token: now } : null
}

export async function renewInstagramPublishLease(
  supabase: any,
  itemId: string,
  leaseToken: string,
  nowMs = Date.now()
): Promise<boolean> {
  const { data, error } = await supabase
    .from('instagram_publish_task_items')
    .update({ updated_at: new Date(nowMs).toISOString() })
    .eq('id', itemId)
    .eq('status', 'uploading')
    .eq('processing_started_at', leaseToken)
    .select('id')
    .maybeSingle()
  if (error) {
    throw new Error(`续租 Instagram 发布任务失败: ${error.message}`)
  }
  return Boolean(data)
}
