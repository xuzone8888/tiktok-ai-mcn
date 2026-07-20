import * as https from 'node:https'

type InstagramOAuthHost = 'api.instagram.com' | 'graph.instagram.com' | 'graph.facebook.com'
type InstagramOAuthMethod = 'GET' | 'POST'

export interface InstagramOAuthTransportRequest {
  host: InstagramOAuthHost
  path: string
  method: InstagramOAuthMethod
  params: Record<string, string>
  timeoutMs?: number
}

export interface InstagramOAuthTransportResponse<T = Record<string, unknown>> {
  status: number
  json: T
}

export type InstagramOAuthTransportErrorCode =
  | 'oauth_transport_blocked_target'
  | 'oauth_transport_redirect_blocked'
  | 'oauth_transport_timeout'
  | 'oauth_transport_tls_error'
  | 'oauth_transport_network_error'
  | 'oauth_transport_http_4xx'
  | 'oauth_transport_http_5xx'
  | 'oauth_transport_invalid_response'
  | 'oauth_transport_response_too_large'

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 1024 * 1024
const FACEBOOK_OAUTH_PATH = /^\/v\d+\.\d+\/oauth\/access_token$/

const ERROR_MESSAGES: Record<InstagramOAuthTransportErrorCode, string> = {
  oauth_transport_blocked_target: 'Instagram OAuth request target is not allowed.',
  oauth_transport_redirect_blocked: 'Instagram OAuth request redirect was blocked.',
  oauth_transport_timeout: 'Instagram OAuth request timed out.',
  oauth_transport_tls_error: 'Instagram OAuth secure connection failed.',
  oauth_transport_network_error: 'Instagram OAuth network request failed.',
  oauth_transport_http_4xx: 'Instagram OAuth request was rejected.',
  oauth_transport_http_5xx: 'Instagram OAuth service is temporarily unavailable.',
  oauth_transport_invalid_response: 'Instagram OAuth returned an invalid response.',
  oauth_transport_response_too_large: 'Instagram OAuth response exceeded the safety limit.',
}

export class InstagramOAuthTransportError extends Error {
  code: InstagramOAuthTransportErrorCode
  httpStatus?: number
  providerCode?: string

  constructor(code: InstagramOAuthTransportErrorCode, httpStatus?: number, providerCode?: string) {
    super(ERROR_MESSAGES[code])
    this.name = 'InstagramOAuthTransportError'
    this.code = code
    this.httpStatus = httpStatus
    this.providerCode = providerCode
  }
}

function isAllowedTarget(host: string, path: string, method: string, hasAuthorizationHeader: boolean) {
  if (path.includes('?') || path.includes('#') || !path.startsWith('/')) return false
  if (host === 'api.instagram.com') {
    return method === 'POST' && path === '/oauth/access_token'
  }
  if (host === 'graph.instagram.com') {
    return method === 'GET' && (
      (!hasAuthorizationHeader && (path === '/access_token' || path === '/refresh_access_token')) ||
      (hasAuthorizationHeader && path === '/me')
    )
  }
  if (host === 'graph.facebook.com') {
    return method === 'GET' && FACEBOOK_OAUTH_PATH.test(path)
  }
  return false
}

function isTlsError(error: NodeJS.ErrnoException) {
  return [
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ].includes(error.code || '')
}

export function classifyInstagramOAuthHttpStatus(status: number): InstagramOAuthTransportErrorCode | null {
  if (status >= 300 && status < 400) return 'oauth_transport_redirect_blocked'
  if (status >= 400 && status < 500) return 'oauth_transport_http_4xx'
  if (status >= 500) return 'oauth_transport_http_5xx'
  return null
}

export function requestSensitiveInstagramOAuthJson<T = Record<string, unknown>>(
  input: InstagramOAuthTransportRequest
): Promise<InstagramOAuthTransportResponse<T>> {
  return requestInstagramOAuthJsonInternal<T>(input)
}

interface InternalInstagramOAuthTransportRequest extends InstagramOAuthTransportRequest {
  authorizationToken?: string
  captureProviderErrorCode?: boolean
}

function requestInstagramOAuthJsonInternal<T = Record<string, unknown>>(
  input: InternalInstagramOAuthTransportRequest
): Promise<InstagramOAuthTransportResponse<T>> {
  const hasAuthorizationHeader = typeof input.authorizationToken === 'string' && input.authorizationToken.length > 0
  if (!isAllowedTarget(input.host, input.path, input.method, hasAuthorizationHeader)) {
    return Promise.reject(new InstagramOAuthTransportError('oauth_transport_blocked_target'))
  }

  const encoded = new URLSearchParams(input.params).toString()
  const requestPath = input.method === 'GET' ? `${input.path}?${encoded}` : input.path
  const body = input.method === 'POST' ? encoded : ''
  const timeoutMs = Math.max(1, Math.min(input.timeoutMs || DEFAULT_TIMEOUT_MS, 30_000))

  return new Promise((resolve, reject) => {
    let settled = false
    let timedOut = false
    let request: ReturnType<typeof https.request> | undefined
    let absoluteTimeout: ReturnType<typeof setTimeout>
    const finishReject = (error: InstagramOAuthTransportError) => {
      if (settled) return
      settled = true
      clearTimeout(absoluteTimeout)
      reject(error)
    }
    absoluteTimeout = setTimeout(() => {
      timedOut = true
      finishReject(new InstagramOAuthTransportError('oauth_transport_timeout'))
      request?.destroy()
    }, timeoutMs)

    try {
      request = https.request({
        protocol: 'https:',
        hostname: input.host,
        port: 443,
        method: input.method,
        path: requestPath,
        headers: {
          ...(input.method === 'POST'
            ? {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
              }
            : {}),
          ...(hasAuthorizationHeader ? { Authorization: `Bearer ${input.authorizationToken}` } : {}),
        },
      }, (response) => {
        const status = response.statusCode || 0
        const statusError = classifyInstagramOAuthHttpStatus(status)
        if (statusError && !input.captureProviderErrorCode) {
          response.resume()
          finishReject(new InstagramOAuthTransportError(statusError, status))
          return
        }
        if (!statusError && (status < 200 || status >= 300)) {
          response.resume()
          finishReject(new InstagramOAuthTransportError('oauth_transport_invalid_response', status))
          return
        }

        let size = 0
        let raw = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          if (settled) return
          size += Buffer.byteLength(chunk)
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy()
            finishReject(new InstagramOAuthTransportError('oauth_transport_response_too_large', status))
            return
          }
          raw += chunk
        })
        response.on('end', () => {
          if (settled) return
          let json: T | null = null
          try {
            json = JSON.parse(raw) as T
          } catch {
            if (!statusError) {
              finishReject(new InstagramOAuthTransportError('oauth_transport_invalid_response', status))
              return
            }
          }
          if (statusError) {
            const providerCode = typeof (json as any)?.error?.code === 'number' || typeof (json as any)?.error?.code === 'string'
              ? String((json as any).error.code)
              : undefined
            finishReject(new InstagramOAuthTransportError(statusError, status, providerCode))
            return
          }
          settled = true
          clearTimeout(absoluteTimeout)
          resolve({ status, json: json as T })
        })
        response.on('error', () => {
          finishReject(new InstagramOAuthTransportError('oauth_transport_network_error'))
        })
      })
    } catch {
      finishReject(new InstagramOAuthTransportError('oauth_transport_network_error'))
      return
    }

    request.setTimeout(timeoutMs, () => {
      timedOut = true
      finishReject(new InstagramOAuthTransportError('oauth_transport_timeout'))
      request?.destroy()
    })
    request.on('error', (error: NodeJS.ErrnoException) => {
      if (timedOut) {
        finishReject(new InstagramOAuthTransportError('oauth_transport_timeout'))
      } else if (isTlsError(error)) {
        finishReject(new InstagramOAuthTransportError('oauth_transport_tls_error'))
      } else {
        finishReject(new InstagramOAuthTransportError('oauth_transport_network_error'))
      }
    })

    try {
      if (body) request.write(body)
      request.end()
    } catch {
      finishReject(new InstagramOAuthTransportError('oauth_transport_network_error'))
    }
  })
}

export type InstagramAccessTokenValidationResult =
  | { status: 'invalid'; invalid: true; httpClassification: '4xx_invalid_token' }
  | { status: 'still_valid'; invalid: false; httpClassification: '2xx' }
  | {
      status: 'inconclusive'
      invalid: false
      httpClassification:
        | '3xx_redirect'
        | '4xx_other'
        | '5xx'
        | 'invalid_response'
        | 'network_error'
        | 'timeout'
        | 'tls_error'
    }

export async function classifyInstagramAccessTokenValidity(
  accessToken: string
): Promise<InstagramAccessTokenValidationResult> {
  try {
    await requestInstagramOAuthJsonInternal({
      host: 'graph.instagram.com',
      path: '/me',
      method: 'GET',
      params: { fields: 'user_id' },
      authorizationToken: accessToken,
      captureProviderErrorCode: true,
    })
    return { status: 'still_valid', invalid: false, httpClassification: '2xx' }
  } catch (error) {
    if (!(error instanceof InstagramOAuthTransportError)) {
      return { status: 'inconclusive', invalid: false, httpClassification: 'network_error' }
    }
    if ((error.httpStatus === 400 || error.httpStatus === 401) && error.providerCode === '190') {
      return { status: 'invalid', invalid: true, httpClassification: '4xx_invalid_token' }
    }
    const classification: InstagramAccessTokenValidationResult['httpClassification'] =
      error.code === 'oauth_transport_redirect_blocked' ? '3xx_redirect'
        : error.code === 'oauth_transport_http_4xx' ? '4xx_other'
          : error.code === 'oauth_transport_http_5xx' ? '5xx'
            : error.code === 'oauth_transport_timeout' ? 'timeout'
              : error.code === 'oauth_transport_tls_error' ? 'tls_error'
                : error.code === 'oauth_transport_invalid_response' || error.code === 'oauth_transport_response_too_large'
                  ? 'invalid_response'
                  : 'network_error'
    return { status: 'inconclusive', invalid: false, httpClassification: classification }
  }
}
