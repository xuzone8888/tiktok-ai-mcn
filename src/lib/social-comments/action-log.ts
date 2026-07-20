export function mergeActionLogMetadata(
  initial: unknown,
  completion: Record<string, unknown> | undefined
): Record<string, unknown> {
  const initialMetadata = initial && typeof initial === 'object' && !Array.isArray(initial)
    ? initial as Record<string, unknown>
    : {}

  return {
    ...initialMetadata,
    ...(completion || {}),
  }
}
