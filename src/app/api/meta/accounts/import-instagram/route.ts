import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    {
      error: 'Meta 混合导入入口已停用。请到 Instagram 账号绑定页单独绑定 Instagram 账号。',
    },
    { status: 410 }
  )
}
