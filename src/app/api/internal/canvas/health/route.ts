import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";

import {
  hasCanvasBearer,
  isCanvasSecretConfigured,
} from "@/lib/canvas/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEALTH_CONTRACT = "canvas-production-health-v1";
const REQUIRED_RPC_COUNT = 27;

type HealthRpcResult = {
  data: unknown;
  error: { code?: string } | null;
};

type HealthRpcClient = {
  rpc(name: "canvas_production_healthcheck_v1"): PromiseLike<HealthRpcResult>;
};

type BuildMetadata = {
  id: string;
  version: string;
};

let buildMetadataPromise: Promise<BuildMetadata> | undefined;

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readBuildMetadata(): Promise<BuildMetadata> {
  const [rawBuildId, rawPackage] = await Promise.all([
    readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf8"),
    readFile(join(process.cwd(), "package.json"), "utf8"),
  ]);
  const id = rawBuildId.trim();
  const parsedPackage = JSON.parse(rawPackage) as { version?: unknown };
  const version =
    typeof parsedPackage.version === "string"
      ? parsedPackage.version.trim()
      : "";

  if (!/^[A-Za-z0-9._-]{1,200}$/u.test(id)) {
    throw new Error("invalid build identifier");
  }
  if (
    version.length < 1 ||
    version.length > 100 ||
    /[\u0000-\u001f\u007f]/u.test(version)
  ) {
    throw new Error("invalid application version");
  }
  return { id, version };
}

function getBuildMetadata(): Promise<BuildMetadata> {
  buildMetadataPromise ??= readBuildMetadata();
  return buildMetadataPromise;
}

function parseHealthRow(data: unknown): {
  contractVersion: string;
  readOnlyProbe: true;
  requiredRpcCount: number;
} | null {
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const value = row as Record<string, unknown>;
  if (
    value.contract_version !== HEALTH_CONTRACT ||
    value.read_only_probe !== true ||
    value.required_rpc_count !== REQUIRED_RPC_COUNT
  ) {
    return null;
  }
  return {
    contractVersion: HEALTH_CONTRACT,
    readOnlyProbe: true,
    requiredRpcCount: REQUIRED_RPC_COUNT,
  };
}

export async function GET(request: NextRequest) {
  if (!isCanvasSecretConfigured("CANVAS_RECONCILE_SECRET")) {
    return json(
      {
        status: "error",
        error: { code: "HEALTH_AUTH_NOT_CONFIGURED" },
      },
      503
    );
  }
  if (!hasCanvasBearer(request, "CANVAS_RECONCILE_SECRET")) {
    return json(
      { status: "error", error: { code: "UNAUTHORIZED" } },
      401
    );
  }

  try {
    const [build, rpcResult] = await Promise.all([
      getBuildMetadata(),
      (
        createAdminClient() as unknown as HealthRpcClient
      ).rpc("canvas_production_healthcheck_v1"),
    ]);
    if (rpcResult.error) {
      console.error("[Canvas health] database probe failed", {
        code: rpcResult.error.code ?? "unknown",
      });
      return json(
        { status: "error", error: { code: "DATABASE_HEALTH_FAILED" } },
        503
      );
    }

    const database = parseHealthRow(rpcResult.data);
    if (!database) {
      console.error("[Canvas health] database contract mismatch");
      return json(
        { status: "error", error: { code: "DATABASE_CONTRACT_MISMATCH" } },
        503
      );
    }

    return json(
      {
        status: "ok",
        build,
        database: {
          reachable: true,
          readOnlyProbe: database.readOnlyProbe,
        },
        canvas: {
          contractVersion: database.contractVersion,
          requiredRpcCount: database.requiredRpcCount,
        },
      },
      200
    );
  } catch (error) {
    console.error("[Canvas health] probe failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json(
      { status: "error", error: { code: "HEALTHCHECK_FAILED" } },
      503
    );
  }
}
