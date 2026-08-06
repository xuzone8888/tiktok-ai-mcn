type AuthCallbackClient = {
  initialize(): Promise<{ error: unknown | null }>;
  getSession(): Promise<{
    data: { session: unknown | null };
    error: unknown | null;
  }>;
};

export function getSafeAuthRedirect(value: string | null): string {
  const fallback = "/models";
  const trustedOrigin = "https://auth-redirect.invalid";
  const hasAsciiControl = value
    ? Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      })
    : false;
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasAsciiControl
  ) {
    return fallback;
  }

  try {
    const resolved = new URL(value, trustedOrigin);
    if (resolved.origin !== trustedOrigin) {
      return fallback;
    }
    const normalized = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    const reparsed = new URL(normalized, trustedOrigin);
    if (
      !reparsed.pathname.startsWith("/") ||
      reparsed.pathname.startsWith("//") ||
      reparsed.origin !== trustedOrigin
    ) {
      return fallback;
    }
    return normalized;
  } catch {
    return fallback;
  }
}

export function hasSupabasePkceCallback(search: string): boolean {
  const params = new URLSearchParams(search);
  return Boolean(params.get("code"));
}

export async function restoreSupabasePkceCallback(
  auth: AuthCallbackClient,
  search: string
): Promise<{
  handled: boolean;
  session: unknown | null;
  error: unknown | null;
}> {
  if (!hasSupabasePkceCallback(search)) {
    return { handled: false, session: null, error: null };
  }

  // @supabase/ssr configures its browser client for PKCE and URL-session
  // detection. initialize() is idempotent and awaits the constructor-started
  // code exchange before getSession() reads the persisted result.
  const initialized = await auth.initialize();
  if (initialized.error) {
    return { handled: true, session: null, error: initialized.error };
  }

  const current = await auth.getSession();
  return {
    handled: true,
    session: current.data.session,
    error: current.error,
  };
}
