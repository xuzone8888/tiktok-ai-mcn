import { createHash, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

export type CanvasSecretEnvName =
  | "CANVAS_RECONCILE_SECRET"
  | "CANVAS_RECOVERY_ADMIN_SECRET"
  | "CANVAS_RECOVERY_APPROVER_SECRET";

function secretsMatch(received: string, expected: string): boolean {
  const receivedDigest = createHash("sha256").update(received).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

export function isCanvasSecretConfigured(
  envName: CanvasSecretEnvName
): boolean {
  const secret = process.env[envName];
  return typeof secret === "string" && secret.length >= 32;
}

export function hasCanvasHeaderSecret(
  request: NextRequest,
  headerName: string,
  envName: CanvasSecretEnvName
): boolean {
  const secret = process.env[envName];
  if (typeof secret !== "string" || secret.length < 32) return false;
  return secretsMatch(request.headers.get(headerName) ?? "", secret);
}

export function hasCanvasBearer(
  request: NextRequest,
  envName: CanvasSecretEnvName
): boolean {
  const secret = process.env[envName];
  if (typeof secret !== "string" || secret.length < 32) return false;

  const authorization = request.headers.get("authorization") ?? "";
  return secretsMatch(authorization, `Bearer ${secret}`);
}

export function isCanvasInternalSecretConfigured(): boolean {
  return isCanvasSecretConfigured("CANVAS_RECONCILE_SECRET");
}

export function hasCanvasInternalBearer(request: NextRequest): boolean {
  return hasCanvasBearer(request, "CANVAS_RECONCILE_SECRET");
}
