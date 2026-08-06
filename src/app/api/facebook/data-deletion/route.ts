import { NextRequest, NextResponse } from 'next/server'

import { deleteFacebookAuthorizationData } from '@/lib/facebook/data-deletion'
import { getFacebookOAuthConfig } from '@/lib/facebook/oauth'
import { verifyFacebookSignedRequest } from '@/lib/facebook/signed-request'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function appOrigin(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || request.nextUrl.origin
}

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
    const result = await deleteFacebookAuthorizationData(payload.user_id)
    const statusUrl = new URL('/facebook-data-deletion', appOrigin(request))
    statusUrl.searchParams.set('code', result.confirmationCode)

    return NextResponse.json({
      url: statusUrl.toString(),
      confirmation_code: result.confirmationCode,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'facebook_data_deletion_failed'
    const invalidRequest = code.startsWith('invalid_') ||
      code.startsWith('expired_') ||
      code.startsWith('missing_')
    console.error('Facebook data deletion callback failed:', { code })
    return NextResponse.json(
      { error: invalidRequest ? code : 'facebook_data_deletion_failed' },
      { status: invalidRequest ? 400 : 500 },
    )
  }
}
