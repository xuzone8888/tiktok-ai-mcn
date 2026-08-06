import { createHmac, timingSafeEqual } from "node:crypto";

const SAVE_PROOF_CONTEXT = "star-gaze:canvas-save-proof:v1";

function proofSecret(): string | null {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return typeof value === "string" && value.length >= 32 ? value : null;
}

function proofDigest(secret: string, canvasId: string, rev: number): Buffer {
  return createHmac("sha256", secret)
    .update(`${SAVE_PROOF_CONTEXT}\0${canvasId}\0${rev}`)
    .digest();
}

/**
 * Opaque proof that this server returned a healthy, current-schema document at an exact revision.
 * It contains no document or credential data and is scoped by the environment's service-role key.
 */
export function issueCanvasSaveProof(canvasId: string, rev: number): string | null {
  const secret = proofSecret();
  if (!secret) return null;
  return proofDigest(secret, canvasId, rev).toString("base64url");
}

/** Constant-time verification for the exact canvas/revision pair supplied by a PATCH. */
export function verifyCanvasSaveProof(
  proof: string,
  canvasId: string,
  rev: number
): boolean {
  const secret = proofSecret();
  if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(proof)) return false;
  try {
    const supplied = Buffer.from(proof, "base64url");
    const expected = proofDigest(secret, canvasId, rev);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}
