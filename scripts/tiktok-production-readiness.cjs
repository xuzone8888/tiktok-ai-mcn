#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const TRUE = 'true'
const PLACEHOLDER = /^(?:replace|placeholder|your[-_]|example(?:\.com)?$)/i

function enabled(value) {
  return String(value || '').trim().toLowerCase() === TRUE
}

function nonEmpty(value) {
  return String(value || '').trim()
}

function parseEnvFile(filename, syntax = 'next') {
  const parsed = {}
  const source = fs.readFileSync(filename, 'utf8')
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const rawValue = match[2].trim()
    let quote = ''
    let escaped = false
    let commentIndex = -1
    let hasUnescapedExpansion = false
    let hasUnsupportedBacktick = false
    for (let index = 0; index < rawValue.length; index += 1) {
      const character = rawValue[index]
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\' && quote !== "'") {
        escaped = true
        continue
      }
      if (
        character === '"'
        || character === "'"
        || (syntax === 'next' && character === '`')
      ) {
        if (!quote) quote = character
        else if (quote === character) quote = ''
        continue
      }
      if (syntax === 'compose' && character === '`') {
        hasUnsupportedBacktick = true
      }
      if (character === '$') {
        hasUnescapedExpansion = true
      }
      if (
        !quote
        && character === '#'
        && (index === 0 || /\s/.test(rawValue[index - 1]))
      ) {
        commentIndex = index
        break
      }
    }
    let value = quote || escaped || hasUnescapedExpansion || hasUnsupportedBacktick
      ? ''
      : (commentIndex >= 0 ? rawValue.slice(0, commentIndex) : rawValue).trim()
    if (
      value.length >= 2
      && (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
        || (
          syntax === 'next'
          && value.startsWith('`')
          && value.endsWith('`')
        )
      )
    ) {
      value = value.slice(1, -1)
    }
    value = value.replace(/\\\$/g, '$')
    parsed[match[1]] = value
  }
  return parsed
}

function loadEffectiveEnv(envFilename, role, processEnvironment = process.env) {
  const resolvedFilename = path.resolve(envFilename)
  if (role === 'broker') {
    const effectiveEnv = parseEnvFile(resolvedFilename, 'compose')
    const composeInterpolatedKeys = [
      'BROKER_LOCAL_PORT',
      'BROKER_PUBLIC_ADDR',
      'BROKER_TLS_PORT',
      'BROKER_UPSTREAM',
      'BROKER_ALLOW_IP',
    ]
    for (const name of composeInterpolatedKeys) {
      if (Object.prototype.hasOwnProperty.call(processEnvironment, name)) {
        effectiveEnv[name] = processEnvironment[name]
      }
    }
    return effectiveEnv
  }

  const directory = path.dirname(resolvedFilename)
  const nodeEnv = 'production'
  const standardFilenames = [
    '.env',
    `.env.${nodeEnv}`,
    ...(nodeEnv === 'test' ? [] : ['.env.local']),
    `.env.${nodeEnv}.local`,
  ]
  const fileEnv = {}
  for (const basename of standardFilenames) {
    const candidate = path.join(directory, basename)
    if (fs.existsSync(candidate)) {
      Object.assign(fileEnv, parseEnvFile(candidate, 'next'))
    }
  }
  if (!standardFilenames.includes(path.basename(resolvedFilename))) {
    Object.assign(fileEnv, parseEnvFile(resolvedFilename, 'next'))
  }
  return { ...fileEnv, ...processEnvironment }
}

function parseStrictHttpsUrl(value, expectedPath = '') {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.search
      || url.hash
      || (expectedPath && url.pathname !== expectedPath)
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

function isPlaceholder(value) {
  const normalized = nonEmpty(value)
  return !normalized
    || PLACEHOLDER.test(normalized)
    || /(?:^|[./])example\.(?:com|net|org)(?:[/:]|$)/i.test(normalized)
}

function isValidPort(value) {
  return /^[1-9]\d{0,4}$/.test(value) && Number(value) <= 65535
}

function isPublicIp(value) {
  const family = net.isIP(value)
  if (family === 4) {
    return isPublicIpv4(value)
  }
  if (family === 6) {
    const words = normalizeIpv6Words(value)
    if (!words) return false
    const firstFiveWordsZero = words.slice(0, 5).every((word) => word === 0)
    if (firstFiveWordsZero && words[5] === 0xffff) {
      const mappedIpv4 = [
        words[6] >> 8,
        words[6] & 0xff,
        words[7] >> 8,
        words[7] & 0xff,
      ].join('.')
      return isPublicIpv4(mappedIpv4)
    }
    if (words.slice(0, 6).every((word) => word === 0)) return false
    const first = words[0]
    const isGlobalUnicast = first >= 0x2000 && first <= 0x3fff
    const isIetfSpecial = first === 0x2001 && words[1] <= 0x01ff
    const isDocumentation = first === 0x2001 && words[1] === 0x0db8
    const isSixToFour = first === 0x2002
    const isDocumentationV2 = first === 0x3fff && words[1] <= 0x0fff
    return isGlobalUnicast
      && !isIetfSpecial
      && !isDocumentation
      && !isSixToFour
      && !isDocumentationV2
  }
  return false
}

function isPublicIpv4(value) {
  const [a, b, c] = value.split('.').map(Number)
    return !(
      a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113)
      || a >= 224
    )
}

function normalizeIpv6Words(value) {
  try {
    const hostname = new URL(`http://[${value}]/`).hostname.slice(1, -1)
    const halves = hostname.split('::')
    if (halves.length > 2) return null
    const left = halves[0] ? halves[0].split(':') : []
    const right = halves[1] ? halves[1].split(':') : []
    const missing = 8 - left.length - right.length
    if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
    const groups = [
      ...left,
      ...Array.from({ length: missing }, () => '0'),
      ...right,
    ]
    if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) {
      return null
    }
    return groups.map((group) => Number.parseInt(group, 16))
  } catch {
    return null
  }
}

function isApprovedHostname(value) {
  const normalized = value.toLowerCase()
  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || /\.(?:example|invalid|test)$/i.test(normalized)
    || isPlaceholder(normalized)
    || normalized.length > 253
    || !normalized.includes('.')
  ) {
    return false
  }
  return normalized.split('.').every(
    (label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  )
}

function isLoopbackHostname(value) {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, '')
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function hasProductionHost(url) {
  return !isLoopbackHostname(url.hostname)
    && (isPublicIp(url.hostname) || isApprovedHostname(url.hostname))
}

function auditTikTokProductionReadiness(env, role = 'app') {
  const errors = []
  const warnings = []
  const checks = []

  const requireValue = (name) => {
    const value = nonEmpty(env[name])
    if (isPlaceholder(value)) {
      errors.push(`${name} must be configured with a non-placeholder value.`)
      return ''
    }
    checks.push(`${name} is configured.`)
    return value
  }
  const requireHttps = (name, expectedPath) => {
    const value = requireValue(name)
    const url = value ? parseStrictHttpsUrl(value, expectedPath) : null
    if (value && !url) {
      errors.push(`${name} must be HTTPS with no credentials, query, or fragment${expectedPath ? ` and use ${expectedPath}` : ''}.`)
    }
    return url
  }
  const requireSecret = (name) => {
    const value = requireValue(name)
    if (value && value.length < 32) {
      errors.push(`${name} must contain at least 32 characters.`)
    }
  }
  const requirePositiveInteger = (name, maximum) => {
    if (!Object.prototype.hasOwnProperty.call(env, name)) {
      errors.push(`${name} must be configured with a non-placeholder value.`)
      return ''
    }
    const value = typeof env[name] === 'string' ? env[name] : ''
    if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) {
      errors.push(`${name} must be an integer from 1 through ${maximum}.`)
      return ''
    }
    return value
  }

  if (role === 'broker') {
    if (nonEmpty(env.OAUTH_BROKER_URL)) {
      errors.push('OAUTH_BROKER_URL must be absent on the broker to prevent recursive calls.')
    }
    requireSecret('BROKER_SECRET')
    requireValue('TIKTOK_BUSINESS_CLIENT_ID')
    requireValue('TIKTOK_BUSINESS_CLIENT_SECRET')
    const readQpm = requirePositiveInteger('TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT', 10000)
    const topLevelBudget = requirePositiveInteger('TIKTOK_COMMENT_TOP_LEVEL_CALL_BUDGET', 100)
    const replyBudget = requirePositiveInteger('TIKTOK_COMMENT_REPLY_CALL_BUDGET', 100)
    if (readQpm && topLevelBudget && Number(topLevelBudget) > Number(readQpm)) {
      errors.push('TIKTOK_COMMENT_TOP_LEVEL_CALL_BUDGET cannot exceed TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT.')
    }
    if (readQpm && replyBudget && Number(replyBudget) > Number(readQpm)) {
      errors.push('TIKTOK_COMMENT_REPLY_CALL_BUDGET cannot exceed TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT.')
    }
    const callbackUrl = requireHttps(
      'TIKTOK_BUSINESS_REDIRECT_URI',
      '/api/tiktok/business-auth/callback/',
    )
    if (callbackUrl && !hasProductionHost(callbackUrl)) {
      errors.push('TIKTOK_BUSINESS_REDIRECT_URI must use an approved production host.')
    }
    const publicAddress = requireValue('BROKER_PUBLIC_ADDR')
    if (
      publicAddress
      && (
        net.isIP(publicAddress) === 6
        || (!isPublicIp(publicAddress) && !isApprovedHostname(publicAddress))
      )
    ) {
      errors.push('BROKER_PUBLIC_ADDR must be a public IPv4 address or approved non-placeholder hostname; raw IPv6 is unsupported by the Caddy site-address template.')
    }
    const allowIp = requireValue('BROKER_ALLOW_IP')
    if (allowIp && !isPublicIp(allowIp)) {
      errors.push('BROKER_ALLOW_IP must be one fixed public IP; CIDRs, private, wildcard, and non-IP values are forbidden.')
    }
    const tlsPort = requireValue('BROKER_TLS_PORT')
    if (tlsPort && !isValidPort(tlsPort)) {
      errors.push('BROKER_TLS_PORT must be an integer from 1 through 65535.')
    }
    const localPort = requireValue('BROKER_LOCAL_PORT')
    if (localPort && !isValidPort(localPort)) {
      errors.push('BROKER_LOCAL_PORT must be an integer from 1 through 65535.')
    }
    const upstream = requireValue('BROKER_UPSTREAM')
    const upstreamMatch = /^(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/.exec(upstream)
    if (
      upstream
      && (
        !upstreamMatch
        || !isValidPort(upstreamMatch[2])
        || !isValidPort(localPort)
        || upstreamMatch[2] !== localPort
      )
    ) {
      errors.push('BROKER_UPSTREAM must be a loopback host using exactly BROKER_LOCAL_PORT.')
    }
    checks.push('Broker role keeps Supabase credentials out of its runtime requirements.')
    return { ok: errors.length === 0, errors, warnings, checks }
  }

  if (role !== 'app') {
    errors.push(`Unknown role "${role}". Expected "app" or "broker".`)
    return { ok: false, errors, warnings, checks }
  }

  requireValue('TIKTOK_CLIENT_KEY')
  requireValue('TIKTOK_CLIENT_SECRET')
  const loginAppUrl = requireHttps('NEXT_PUBLIC_APP_URL', '/')
  const loginCallbackUrl = requireHttps(
    'TIKTOK_REDIRECT_URI',
    '/api/tiktok/auth/callback',
  )
  if (loginAppUrl && !hasProductionHost(loginAppUrl)) {
    errors.push('NEXT_PUBLIC_APP_URL must use an approved production host.')
  }
  if (loginCallbackUrl && !hasProductionHost(loginCallbackUrl)) {
    errors.push('TIKTOK_REDIRECT_URI must use an approved production host.')
  }
  if (loginAppUrl && loginCallbackUrl && loginAppUrl.origin !== loginCallbackUrl.origin) {
    errors.push('TIKTOK_REDIRECT_URI origin must exactly match NEXT_PUBLIC_APP_URL.')
  }

  const rolloutFlags = {}
  for (const name of [
    'TIKTOK_VIDEO_LIST_SCOPE_ENABLED',
    'NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED',
    'ENABLE_VIDEO_STATS_SYNC',
  ]) {
    const configured = Object.prototype.hasOwnProperty.call(env, name)
    const value = configured ? env[name] : undefined
    if (configured && value !== 'true' && value !== 'false') {
      errors.push(`${name} must be the exact literal true or false when configured.`)
    }
    rolloutFlags[name] = value === 'true'
  }
  const videoListScopeEnabled = rolloutFlags.TIKTOK_VIDEO_LIST_SCOPE_ENABLED
  const videoListUiEnabled = rolloutFlags.NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED
  const videoStatsSyncEnabled = rolloutFlags.ENABLE_VIDEO_STATS_SYNC
  if (videoListScopeEnabled !== videoListUiEnabled) {
    errors.push('TikTok video-list UI and OAuth scope gates must be enabled or disabled together.')
  }
  if (videoListScopeEnabled) {
    warnings.push('Confirm the TikTok app revision with video.list is Live before enabling the Production video-list gates.')
  }
  if (videoStatsSyncEnabled && !videoListScopeEnabled) {
    errors.push('TikTok video stats sync requires the video.list OAuth scope and UI rollout gates.')
  }

  const apiEnabled = enabled(env.SOCIAL_COMMENTS_API_ENABLED)
  const platforms = new Set(
    nonEmpty(env.SOCIAL_COMMENTS_ENABLED_PLATFORMS)
      .split(/[,\s]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
  const tiktokAllowed = platforms.has('tiktok')
  const pageEnabled = enabled(env.NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED)
  const serverReplyEnabled = enabled(env.TIKTOK_COMMENTS_REPLY_ENABLED)
  const uiReplyEnabled = enabled(env.NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED)
  const anyTikTokCommentsEnabled = tiktokAllowed || pageEnabled || serverReplyEnabled || uiReplyEnabled

  if (pageEnabled && (!apiEnabled || !tiktokAllowed)) {
    errors.push('TikTok comments UI requires SOCIAL_COMMENTS_API_ENABLED=true and tiktok in SOCIAL_COMMENTS_ENABLED_PLATFORMS.')
  }
  if (serverReplyEnabled && (!apiEnabled || !tiktokAllowed || !pageEnabled)) {
    errors.push('TikTok reply server gate requires the API, tiktok allowlist, and TikTok comments page gate.')
  }
  if (uiReplyEnabled && (!serverReplyEnabled || !pageEnabled)) {
    errors.push('TikTok reply UI gate requires both server reply and comments page gates.')
  }

  if (anyTikTokCommentsEnabled) {
    requireValue('TIKTOK_BUSINESS_CLIENT_ID')
    requireValue('TIKTOK_BUSINESS_CLIENT_SECRET')
    const readQpm = requirePositiveInteger('TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT', 10000)
    const topLevelBudget = requirePositiveInteger('TIKTOK_COMMENT_TOP_LEVEL_CALL_BUDGET', 100)
    const replyBudget = requirePositiveInteger('TIKTOK_COMMENT_REPLY_CALL_BUDGET', 100)
    if (readQpm && topLevelBudget && Number(topLevelBudget) > Number(readQpm)) {
      errors.push('TIKTOK_COMMENT_TOP_LEVEL_CALL_BUDGET cannot exceed TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT.')
    }
    if (readQpm && replyBudget && Number(replyBudget) > Number(readQpm)) {
      errors.push('TIKTOK_COMMENT_REPLY_CALL_BUDGET cannot exceed TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT.')
    }
    const callbackUrl = requireHttps(
      'TIKTOK_BUSINESS_REDIRECT_URI',
      '/api/tiktok/business-auth/callback/',
    )
    if (callbackUrl && !hasProductionHost(callbackUrl)) {
      errors.push('TIKTOK_BUSINESS_REDIRECT_URI must use an approved production host.')
    }
    if (loginAppUrl && callbackUrl && loginAppUrl.origin !== callbackUrl.origin) {
      errors.push('TIKTOK_BUSINESS_REDIRECT_URI origin must exactly match NEXT_PUBLIC_APP_URL.')
    }
  }

  const brokerUrl = nonEmpty(env.OAUTH_BROKER_URL)
  if (brokerUrl) {
    const configuredBrokerUrl = requireValue('OAUTH_BROKER_URL')
    const parsedBrokerUrl = configuredBrokerUrl
      ? parseStrictHttpsUrl(configuredBrokerUrl, '/')
      : null
    if (
      configuredBrokerUrl
      && (
        !parsedBrokerUrl
        || !hasProductionHost(parsedBrokerUrl)
      )
    ) {
      errors.push('OAUTH_BROKER_URL must be a non-placeholder production HTTPS origin with no credentials, path, query, fragment, or loopback host.')
    }
    requireSecret('BROKER_SECRET')
    warnings.push('Confirm the broker uses the same BROKER_SECRET and Business OAuth values without printing them.')
  } else if (anyTikTokCommentsEnabled) {
    warnings.push('OAUTH_BROKER_URL is unset; confirm the application host can reach TikTok Business API directly.')
  }

  if (pageEnabled || uiReplyEnabled || videoListUiEnabled) {
    warnings.push('NEXT_PUBLIC_* flags are build-time values; rebuild the application after changing them.')
  }
  if (role === 'app') {
    warnings.push('Confirm migrations 20260723 through 20260911 are applied in order, including both 20260909 hardening migrations and 20260911 user deletion, and confirm the PostgREST schema cache is ready before deploying this application build.')
  }

  checks.push('Legacy /publish aliases and legacy TikTok token columns remain compatibility-only.')
  checks.push(`TikTok video-list rollout gates are both ${videoListScopeEnabled ? 'enabled' : 'disabled'}.`)
  checks.push(`TikTok video stats sync is ${videoStatsSyncEnabled ? 'enabled' : 'disabled'}.`)
  return { ok: errors.length === 0, errors, warnings, checks }
}

function readArg(name) {
  const prefix = `--${name}=`
  const value = process.argv.find((arg) => arg.startsWith(prefix))
  return value ? value.slice(prefix.length) : ''
}

if (require.main === module) {
  const role = readArg('role') || 'app'
  const envFilename = readArg('env')
  const env = envFilename
    ? loadEffectiveEnv(envFilename, role)
    : process.env
  const result = auditTikTokProductionReadiness(env, role)

  for (const check of result.checks) console.log(`PASS ${check}`)
  for (const warning of result.warnings) console.warn(`WARN ${warning}`)
  for (const error of result.errors) console.error(`FAIL ${error}`)
  console.log(result.ok ? 'TikTok production readiness: PASS' : 'TikTok production readiness: FAIL')
  process.exitCode = result.ok ? 0 : 1
}

module.exports = {
  auditTikTokProductionReadiness,
  loadEffectiveEnv,
  parseEnvFile,
}
