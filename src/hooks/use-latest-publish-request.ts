'use client'

import { useEffect, useRef } from 'react'

import { createLatestRequestGate } from '@/lib/publish/latest-request'

export function useLatestPublishRequest() {
  const gate = useRef<ReturnType<typeof createLatestRequestGate> | null>(null)
  if (!gate.current) gate.current = createLatestRequestGate()
  const current = gate.current
  useEffect(() => () => current.cancel(), [current])
  return current
}
