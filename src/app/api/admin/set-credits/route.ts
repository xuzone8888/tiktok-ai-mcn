import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { success: false, error: "此临时积分调试接口已永久停用" },
    { status: 410 }
  );
}
