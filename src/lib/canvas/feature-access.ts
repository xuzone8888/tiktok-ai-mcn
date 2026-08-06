import "server-only";

export interface CanvasAccessIdentity {
  id: string;
  email?: string | null;
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function csvSet(value: string | undefined, normalize = false): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (normalize ? item.toLowerCase() : item))
  );
}

/**
 * Server-authoritative release gate.
 *
 * Production is fail-closed until either the global flag is enabled or the
 * authenticated account appears in the canary allowlist.  The public flag is
 * only a navigation hint; API/page authorization must always use this helper.
 */
export function canAccessSuperCanvas(identity: CanvasAccessIdentity): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (enabled(process.env.CANVAS_PUBLIC_ENABLED)) return true;

  const userIds = csvSet(process.env.CANVAS_ACCESS_USER_IDS);
  if (userIds.has(identity.id)) return true;

  const email = identity.email?.trim().toLowerCase();
  return Boolean(
    email && csvSet(process.env.CANVAS_ACCESS_EMAILS, true).has(email)
  );
}
