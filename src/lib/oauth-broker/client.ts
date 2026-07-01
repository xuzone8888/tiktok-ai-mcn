// CN-only OAuth egress shim（方案 C）：把 CN 打不通的 Meta/Google OAuth 服务端调用
// 转给美国 broker 完成。仅当 OAUTH_BROKER_URL 配置时启用（CN 生产）；本地 dev / 美国 worker /
// broker 自身都不设它 → 调用方走原直连逻辑，行为零变化。
//
// 不需要 undici/ProxyAgent：这只是一个普通 HTTPS fetch，目标是一个 CN 够得到的美国端点
//（只有 Meta/Google 那几个域被 CN 墙，普通美国 VPS 自定义端口可达）。transport 细节（URL/密钥）
// 全走 env，不写死。

export type BrokerPlatform = 'facebook' | 'youtube' | 'instagram'

const BROKER_TIMEOUT_MS = 15000

/** 传输层故障（broker 不可达 / 非 2xx / 超时）。刻意不带 httpStatus —— 上层据此当瞬时错误，
 *  绝不把账号标记为 expired（仅 Meta/Google 真的回 400/401 才标）。 */
export class BrokerTransportError extends Error {
  readonly transport = true
  constructor(message: string) {
    super(message)
    this.name = 'BrokerTransportError'
  }
}

export function isBrokerEnabled(): boolean {
  return Boolean(process.env.OAUTH_BROKER_URL && process.env.OAUTH_BROKER_URL.trim())
}

function brokerEndpoint(): string {
  const base = (process.env.OAUTH_BROKER_URL || '').trim().replace(/\/$/, '')
  return `${base}/api/oauth-broker/call`
}

// 脱敏：抛给上层的任何 message 都不得含 broker host / bearer。回调会把 err.message 写进
// *_auth_states.error_message 并塞进 ?error= 重定向，绝不能泄露端点/密钥。
function redact(message: string): string {
  let out = message
  const base = (process.env.OAUTH_BROKER_URL || '').trim()
  if (base) out = out.split(base).join('[broker]')
  const secret = process.env.BROKER_SECRET
  if (secret) out = out.split(secret).join('[redacted]')
  return out
}

type BrokerResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: string; httpStatus: number | null }

export async function callBroker<T>(
  platform: BrokerPlatform,
  op: string,
  args: Record<string, unknown>,
): Promise<T> {
  const secret = process.env.BROKER_SECRET
  if (!secret) {
    // 配置缺失视为传输故障，不污染 expired 判定。
    throw new BrokerTransportError('OAuth broker is enabled but BROKER_SECRET is not configured')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BROKER_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(brokerEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ platform, op, args }),
      signal: controller.signal,
    })
  } catch (err) {
    // 连接失败 / DNS / 超时(abort)：传输故障。
    throw new BrokerTransportError(
      redact(`OAuth broker request failed: ${err instanceof Error ? err.message : String(err)}`),
    )
  } finally {
    clearTimeout(timer)
  }

  // broker 自身的 4xx/5xx（鉴权失败 / 网关 / 递归护栏）≠ Meta 拒绝 → 当瞬时错误。
  // Meta/Google 真的拒绝时，broker 回 HTTP 200 且 body.ok=false 携带 httpStatus。
  if (!response.ok) {
    throw new BrokerTransportError(`OAuth broker returned transport status ${response.status}`)
  }

  const data = (await response.json().catch(() => null)) as BrokerResponse<T> | null
  if (!data || typeof (data as { ok?: unknown }).ok !== 'boolean') {
    throw new BrokerTransportError('OAuth broker returned an unparseable response')
  }

  if (data.ok) {
    return data.result
  }

  // Meta/Google 真的拒了：还原成带 httpStatus 的 Error，让上层 expired 判定继续生效。
  const error = new Error(redact(data.error || 'OAuth broker call failed')) as Error & { httpStatus?: number }
  if (typeof data.httpStatus === 'number') {
    error.httpStatus = data.httpStatus
  }
  throw error
}
