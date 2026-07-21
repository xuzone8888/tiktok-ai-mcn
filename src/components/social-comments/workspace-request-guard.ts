export interface WorkspaceRequestToken {
  key: string
  generation: number
}

export interface WorkspaceRequestGuard {
  activate(key: string): WorkspaceRequestToken
  capture(): WorkspaceRequestToken
  isActive(token: WorkspaceRequestToken): boolean
  currentKey(): string
}

export function createWorkspaceRequestGuard(initialKey: string): WorkspaceRequestGuard {
  let key = initialKey
  let generation = 0

  return {
    activate(nextKey) {
      if (nextKey !== key) {
        key = nextKey
        generation += 1
      }
      return { key, generation }
    },
    capture() {
      return { key, generation }
    },
    isActive(token) {
      return token.key === key && token.generation === generation
    },
    currentKey() {
      return key
    },
  }
}
