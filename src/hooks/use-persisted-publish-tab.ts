'use client'

import { useCallback, useEffect, useState } from 'react'

export type PublishPageTab = 'create' | 'tasks' | 'comments'

const TAB_QUERY_KEY = 'tab'

export function resolvePublishPageTab(value: string | null, showCommentManagement: boolean): PublishPageTab {
  if (value === 'tasks') return 'tasks'
  if (value === 'comments' && showCommentManagement) return 'comments'
  return 'create'
}

export function buildPublishPageTabUrl(href: string, tab: PublishPageTab): string {
  const url = new URL(href)
  if (tab === 'create') {
    url.searchParams.delete(TAB_QUERY_KEY)
  } else {
    url.searchParams.set(TAB_QUERY_KEY, tab)
  }
  return `${url.pathname}${url.search}${url.hash}`
}

export function usePersistedPublishTab(showCommentManagement: boolean) {
  const [activeTab, setActiveTabState] = useState<PublishPageTab>('create')

  useEffect(() => {
    const syncFromLocation = () => {
      const url = new URL(window.location.href)
      const requestedTab = url.searchParams.get(TAB_QUERY_KEY)
      const nextTab = resolvePublishPageTab(requestedTab, showCommentManagement)
      setActiveTabState(nextTab)

      if (requestedTab && requestedTab !== nextTab) {
        window.history.replaceState(window.history.state, '', buildPublishPageTabUrl(url.href, nextTab))
      }
    }

    syncFromLocation()
    window.addEventListener('popstate', syncFromLocation)
    return () => window.removeEventListener('popstate', syncFromLocation)
  }, [showCommentManagement])

  const setActiveTab = useCallback((nextTab: PublishPageTab) => {
    const resolvedTab = resolvePublishPageTab(nextTab, showCommentManagement)
    setActiveTabState(resolvedTab)
    window.history.replaceState(
      window.history.state,
      '',
      buildPublishPageTabUrl(window.location.href, resolvedTab)
    )
  }, [showCommentManagement])

  return [activeTab, setActiveTab] as const
}
