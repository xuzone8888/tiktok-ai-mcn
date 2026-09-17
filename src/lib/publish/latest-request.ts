/** A stale response must not update data, errors, pagination, or loading state. */
export function createLatestRequestGate() {
  let active: AbortController | null = null
  return {
    begin() {
      active?.abort()
      const controller = new AbortController()
      active = controller
      return { signal: controller.signal, isCurrent: () => active === controller && !controller.signal.aborted }
    },
    cancel() { active?.abort(); active = null },
  }
}
