// 服务端发布流程会用用户提交的 video_url 在服务器侧 fetch（Facebook/YouTube）。
// 该工具用于阻断指向私网/环回/链路本地地址的请求，作为 SSRF 基础防护。
//
// 局限：这是同步的「字面量 IP / 内网域名后缀」检查，可挡住直接用私网或云元数据 IP 的 SSRF
// （如 https://169.254.169.254、http://10.x、http://192.168.x），但无法挡住「公网域名解析到私网」
// 的 DNS 重绑定。完整防护需在 fetch 前做 DNS 解析 + 解析结果 IP 校验，或改用主机白名单 + 禁止跟随重定向，
// 列为后续加固项。

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false
  }
  const [a, b] = parts
  if (a === 0 || a === 127) return true            // this-network / loopback
  if (a === 10) return true                        // private
  if (a === 169 && b === 254) return true          // link-local（含 169.254.169.254 云元数据）
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true          // private
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
  return false
}

/** 判断主机名是否为私网/环回/链路本地（字面量 IP 或内网域名后缀）。 */
export function isPrivateOrLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true
  }

  // IPv6 字面量（含冒号）
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true
    if (host.startsWith('fe80:')) return true                 // 链路本地
    if (host.startsWith('fc') || host.startsWith('fd')) return true // 唯一本地 fc00::/7
    // IPv4-mapped IPv6：WHATWG URL 会把 [::ffff:127.0.0.1] 规范化成十六进制 ::ffff:7f00:1，
    // 必须按十六进制还原成 IPv4 再判定，否则环回/私网/云元数据(169.254.169.254)会绕过。
    const hexMapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hexMapped) {
      const high = parseInt(hexMapped[1], 16)
      const low = parseInt(hexMapped[2], 16)
      return isPrivateIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
    }
    const dotMapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (dotMapped) return isPrivateIPv4(dotMapped[1])
    return false
  }

  // IPv4 字面量；普通公网域名直接放行（见上文 DNS 重绑定局限）
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return isPrivateIPv4(host)
  }

  return false
}
