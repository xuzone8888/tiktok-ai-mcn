export interface StoredInstagramAuthState {
  state: string
  code_verifier: string | null
  status: string
  expires_at: string
  created_at: string
}

const POSTGRES_UNIQUE_VIOLATION = '23505'

export function selectReusableInstagramAuthState(
  rows: readonly StoredInstagramAuthState[],
  nowMs = Date.now()
): StoredInstagramAuthState | null {
  const reusable = rows
    .filter((row) => row.status === 'pending' && Date.parse(row.expires_at) > nowMs)
    .sort((left, right) => {
      const createdAtDelta = Date.parse(left.created_at) - Date.parse(right.created_at)
      return createdAtDelta || left.state.localeCompare(right.state)
    })

  return reusable[0] || null
}

export function shouldReadBackInstagramAuthStateAfterInsertError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
}
