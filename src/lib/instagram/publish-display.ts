import {
  INSTAGRAM_MEDIA_CREATE_OUTCOME_UNKNOWN_CODE,
  INSTAGRAM_MEDIA_PUBLISH_OUTCOME_UNKNOWN_CODE,
  INSTAGRAM_RECONCILIATION_REQUIRED_CODE,
} from '@/lib/instagram/publish-state'

export function getInstagramPublishReconciliationDisplay(
  platform: string,
  errorCode: string | null | undefined,
  isEnglish: boolean
) {
  if (platform === 'instagram' && errorCode === INSTAGRAM_MEDIA_PUBLISH_OUTCOME_UNKNOWN_CODE) {
    return {
      label: isEnglish ? 'Publish outcome unknown, verification required' : '发布结果未知，需人工核对',
      message: isEnglish
        ? 'The Instagram publish request outcome is unknown. Verify the media status manually before any retry.'
        : 'Instagram 发布请求结果未知，请人工核对平台状态后再决定是否重试。',
    }
  }
  if (platform === 'instagram' && errorCode === INSTAGRAM_MEDIA_CREATE_OUTCOME_UNKNOWN_CODE) {
    return {
      label: isEnglish ? 'Publish result unknown, verification required' : '发布结果未知，需人工核对',
      message: isEnglish
        ? 'The Instagram container result is unknown. Verify the platform state manually before any retry.'
        : 'Instagram 发布容器结果未知，请人工核对平台状态后再决定是否重试。',
    }
  }
  if (platform !== 'instagram' || errorCode !== INSTAGRAM_RECONCILIATION_REQUIRED_CODE) {
    return null
  }

  return {
    label: isEnglish ? 'Published, verification required' : '已发布，需人工核对',
    message: isEnglish
      ? 'Instagram reported the media as published, but the final local media state requires manual verification.'
      : 'Instagram 已报告媒体发布完成，但本地最终媒体状态需要人工核对。',
  }
}
