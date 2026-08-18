/**
 * @deprecated Canvas P1 — unauthenticated credit mutation surface retired.
 *
 * Keep the route as a deterministic compatibility tombstone so stale clients
 * receive an explicit permanent failure. Credit debits must happen only inside
 * the reviewed server-owned generation/credit boundary.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "该积分扣除接口已永久停用",
    },
    { status: 410 }
  );
}
