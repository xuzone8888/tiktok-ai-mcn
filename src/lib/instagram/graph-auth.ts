export function instagramGraphHeaders(
  accessToken: string,
  headers: Record<string, string> = {}
): Record<string, string> {
  return {
    ...headers,
    Authorization: `Bearer ${accessToken}`,
  }
}
