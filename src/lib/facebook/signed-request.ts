import crypto from 'crypto'

const META_SIGNED_REQUEST_MAX_AGE_SECONDS = 24 * 60 * 60

export interface FacebookSignedRequestPayload {
  algorithm: 'HMAC-SHA256'
  issued_at: number
  user_id: string
  [key: string]: unknown
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

export function verifyFacebookSignedRequest(
  signedRequest: string,
  appSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): FacebookSignedRequestPayload {
  const [encodedSignature, encodedPayload, extra] = signedRequest.split('.')
  if (!encodedSignature || !encodedPayload || extra !== undefined) {
    throw new Error('invalid_signed_request')
  }

  const providedSignature = decodeBase64Url(encodedSignature)
  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(encodedPayload)
    .digest()
  if (
    providedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error('invalid_signed_request_signature')
  }

  let payload: unknown
  try {
    payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'))
  } catch {
    throw new Error('invalid_signed_request_payload')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('invalid_signed_request_payload')
  }

  const record = payload as Record<string, unknown>
  if (record.algorithm !== 'HMAC-SHA256') {
    throw new Error('invalid_signed_request_algorithm')
  }
  if (
    typeof record.issued_at !== 'number' ||
    !Number.isFinite(record.issued_at) ||
    record.issued_at <= 0 ||
    record.issued_at > nowSeconds + 300 ||
    nowSeconds - record.issued_at > META_SIGNED_REQUEST_MAX_AGE_SECONDS
  ) {
    throw new Error('expired_signed_request')
  }
  if (typeof record.user_id !== 'string' || !record.user_id.trim()) {
    throw new Error('missing_signed_request_user')
  }

  return record as FacebookSignedRequestPayload
}
