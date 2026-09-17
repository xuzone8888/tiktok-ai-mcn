const inFlight = new Set<string>()

/** Call after refreshed comments are displayed; never await from the sync UI. */
export function scheduleFacebookPostIdentityRecovery(
  platform: string,
  result: { facebookIdentityRecoveryLogId?: string; results?: { facebookIdentityRecoveryLogId?: string }[] },
  headers: Record<string, string>,
): void {
  if (platform !== 'facebook') return
  const ids = [result.facebookIdentityRecoveryLogId, ...(result.results || []).map(row => row.facebookIdentityRecoveryLogId)]
  const pending = [...new Set(ids)].filter((id): id is string => typeof id === 'string' && Boolean(id) && !inFlight.has(id)).slice(0, 10)
  pending.forEach(id => inFlight.add(id))
  // Separate HTTP requests keep recovery out of the comment request's lifetime.
  void (async () => {
    for (const logId of pending) {
      try {
        await fetch('/api/facebook/post-identity/recover', {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ logId }), signal: AbortSignal.timeout(60_000),
        })
      } catch {
        // A later sync provides a fresh recovery opportunity. Never claim success here.
      } finally { inFlight.delete(logId) }
    }
  })()
}
