import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getFacebookOAuthConfig } from '@/lib/facebook/oauth'
import { verifyFacebookSignedRequest } from '@/lib/facebook/signed-request'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = new URLSearchParams(await request.text())
  const signedRequest = body.get('signed_request')
  if (!signedRequest) {
    return NextResponse.json({ error: 'missing_signed_request' }, { status: 400 })
  }

  try {
    const payload = verifyFacebookSignedRequest(
      signedRequest,
      getFacebookOAuthConfig().clientSecret,
    )
    const admin = createAdminClient() as any
    const { data: deletion, error } = await admin.rpc(
      'delete_facebook_authorization_data',
      { p_facebook_user_id: payload.user_id },
    )
    if (error) {
      throw new Error('facebook_deauthorization_cleanup_failed')
    }
    return NextResponse.json({ success: true, deletion })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'facebook_deauthorization_failed'
    const invalidRequest = code.startsWith('invalid_') ||
      code.startsWith('expired_') ||
      code.startsWith('missing_')
    console.error('Facebook deauthorization callback failed:', { code })
    return NextResponse.json(
      { error: invalidRequest ? code : 'facebook_deauthorization_failed' },
      { status: invalidRequest ? 400 : 500 },
    )
  }
}
