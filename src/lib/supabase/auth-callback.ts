import type { EmailOtpType } from "@supabase/supabase-js";

type AuthResult = {
  data: { session: unknown | null };
  error: unknown | null;
};

type AuthCallbackClient = {
  exchangeCodeForSession(code: string): Promise<AuthResult>;
  verifyOtp(params: {
    token_hash: string;
    type: EmailOtpType;
  }): Promise<AuthResult>;
  setSession(params: {
    access_token: string;
    refresh_token: string;
  }): Promise<AuthResult>;
};

type ParsedAuthCallback =
  | { kind: "none" }
  | { kind: "invalid"; error: Error }
  | { kind: "provider_error"; error: Error }
  | { kind: "pkce"; code: string }
  | { kind: "token_hash"; tokenHash: string; type: EmailOtpType }
  | { kind: "legacy_hash"; accessToken: string; refreshToken: string };

export type AuthCallbackResult = {
  handled: boolean;
  session: unknown | null;
  error: unknown | null;
  scrubbedPath: string | null;
};

const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

const AUTH_QUERY_KEYS = [
  "code",
  "token_hash",
  "type",
  "error",
  "error_code",
  "error_description",
] as const;

const AUTH_QUERY_TRIGGER_KEYS = [
  "code",
  "token_hash",
  "error",
  "error_code",
  "error_description",
] as const;

const AUTH_HASH_KEYS = [
  "access_token",
  "refresh_token",
  "error",
  "error_code",
  "error_description",
] as const;

function callbackError(message: string): Error {
  const error = new Error(message);
  error.name = "AuthCallbackError";
  return error;
}

function hasDuplicate(params: URLSearchParams, key: string): boolean {
  return params.getAll(key).length > 1;
}

function hasInvalidToken(value: string | null): boolean {
  if (!value || value.length > 8192 || value !== value.trim()) {
    return true;
  }

  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function parseSupabaseAuthCallback(search: string, hash: string): ParsedAuthCallback {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const hasQueryCallback = AUTH_QUERY_KEYS.some((key) => query.has(key));
  const hasHashCallback = AUTH_HASH_KEYS.some((key) => fragment.has(key));

  if (!hasQueryCallback && !hasHashCallback) {
    return { kind: "none" };
  }

  if (
    AUTH_QUERY_KEYS.some((key) => hasDuplicate(query, key)) ||
    AUTH_HASH_KEYS.some((key) => hasDuplicate(fragment, key))
  ) {
    return { kind: "invalid", error: callbackError("Duplicate auth callback parameters") };
  }

  if (hasQueryCallback && hasHashCallback) {
    return { kind: "invalid", error: callbackError("Ambiguous auth callback parameters") };
  }

  if (hasHashCallback) {
    if (fragment.has("error") || fragment.has("error_code") || fragment.has("error_description")) {
      return { kind: "provider_error", error: callbackError("Authentication provider rejected the callback") };
    }

    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    if (hasInvalidToken(accessToken) || hasInvalidToken(refreshToken)) {
      return { kind: "invalid", error: callbackError("Invalid legacy auth callback") };
    }

    return {
      kind: "legacy_hash",
      accessToken: accessToken!,
      refreshToken: refreshToken!,
    };
  }

  const hasProviderError =
    query.has("error") || query.has("error_code") || query.has("error_description");
  const hasCode = query.has("code");
  const hasTokenHash = query.has("token_hash");
  const hasType = query.has("type");

  if (hasProviderError && (hasCode || hasTokenHash || hasType)) {
    return { kind: "invalid", error: callbackError("Ambiguous auth callback parameters") };
  }

  if (hasProviderError) {
    return { kind: "provider_error", error: callbackError("Authentication provider rejected the callback") };
  }

  const code = query.get("code");
  const tokenHash = query.get("token_hash");
  const type = query.get("type");

  if (hasCode && (hasTokenHash || hasType)) {
    return { kind: "invalid", error: callbackError("Ambiguous auth callback parameters") };
  }

  if (hasCode) {
    if (hasInvalidToken(code)) {
      return { kind: "invalid", error: callbackError("Invalid PKCE auth callback") };
    }
    return { kind: "pkce", code: code! };
  }

  if (!hasTokenHash || !hasType || hasInvalidToken(tokenHash) || !EMAIL_OTP_TYPES.has(type as EmailOtpType)) {
    return { kind: "invalid", error: callbackError("Invalid token hash auth callback") };
  }

  return { kind: "token_hash", tokenHash: tokenHash!, type: type as EmailOtpType };
}

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

export function hasSupabaseAuthCallbackQuery(search: string): boolean {
  const params = new URLSearchParams(search);
  return AUTH_QUERY_TRIGGER_KEYS.some((key) => params.has(key));
}

export function hasSupabaseAuthCallback(search: string, hash: string): boolean {
  return parseSupabaseAuthCallback(search, hash).kind !== "none";
}

export function getScrubbedAuthCallbackPath(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  for (const key of AUTH_QUERY_KEYS) {
    params.delete(key);
  }
  if (params.has("redirect")) {
    const safeRedirect = getSafeAuthRedirect(params.get("redirect"));
    params.delete("redirect");
    params.set("redirect", safeRedirect);
  }
  const scrubbedSearch = params.toString();
  return `${pathname}${scrubbedSearch ? `?${scrubbedSearch}` : ""}`;
}

export async function restoreSupabaseAuthCallback(
  createAuthClient: () => AuthCallbackClient,
  search: string,
  hash: string,
  pathname: string,
  scrubUrl: (scrubbedPath: string) => void
): Promise<AuthCallbackResult> {
  const parsed = parseSupabaseAuthCallback(search, hash);
  if (parsed.kind === "none") {
    return { handled: false, session: null, error: null, scrubbedPath: null };
  }

  const scrubbedPath = getScrubbedAuthCallbackPath(pathname, search);
  // This must happen before createBrowserClient is constructed. Its default
  // URL detection would otherwise consume PKCE/implicit callback credentials.
  scrubUrl(scrubbedPath);

  if (parsed.kind === "invalid" || parsed.kind === "provider_error") {
    return { handled: true, session: null, error: parsed.error, scrubbedPath };
  }

  let result: AuthResult;
  try {
    const auth = createAuthClient();
    if (parsed.kind === "pkce") {
      result = await auth.exchangeCodeForSession(parsed.code);
    } else if (parsed.kind === "token_hash") {
      result = await auth.verifyOtp({ token_hash: parsed.tokenHash, type: parsed.type });
    } else {
      result = await auth.setSession({
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken,
      });
    }
  } catch (error) {
    return { handled: true, session: null, error, scrubbedPath };
  }

  return {
    handled: true,
    session: result.error ? null : result.data.session,
    error: result.error || (!result.data.session ? callbackError("Auth callback did not create a session") : null),
    scrubbedPath,
  };
}
