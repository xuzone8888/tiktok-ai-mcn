export const TIKTOK_PUBLISH_PATH = '/tiktok-publish'
export const TIKTOK_ACCOUNTS_PATH = `${TIKTOK_PUBLISH_PATH}/accounts`
export const TIKTOK_COMMENTS_PATH = `${TIKTOK_PUBLISH_PATH}/comments`

export const LEGACY_TIKTOK_PUBLISH_PATH = '/publish'
export const LEGACY_TIKTOK_ACCOUNTS_PATH = `${LEGACY_TIKTOK_PUBLISH_PATH}/accounts`

export function buildTikTokAccountsUrl(
  baseUrl: string,
  params: Record<string, string>
) {
  const url = new URL(TIKTOK_ACCOUNTS_PATH, baseUrl)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

export function isSidebarNavItemActive(pathname: string, itemHref: string) {
  if (itemHref === TIKTOK_ACCOUNTS_PATH) {
    return pathname === TIKTOK_ACCOUNTS_PATH || pathname === LEGACY_TIKTOK_ACCOUNTS_PATH
  }

  if (itemHref === TIKTOK_PUBLISH_PATH) {
    return (
      pathname === TIKTOK_PUBLISH_PATH
      || pathname === TIKTOK_COMMENTS_PATH
      || pathname === LEGACY_TIKTOK_PUBLISH_PATH
    )
  }

  return pathname === itemHref
}
