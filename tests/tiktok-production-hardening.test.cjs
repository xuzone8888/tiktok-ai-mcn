/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  auditTikTokProductionReadiness,
  parseEnvFile,
} = require('../scripts/tiktok-production-readiness.cjs')

const cleanSpawnEnv = (overrides = {}) => ({
  PATH: process.env.PATH || '/usr/bin:/bin',
  ...overrides,
})

const businessEnv = {
  NEXT_PUBLIC_APP_URL: 'https://app.stargaze.cn/',
  TIKTOK_CLIENT_KEY: 'production-login-client',
  TIKTOK_CLIENT_SECRET: 'production-login-secret',
  TIKTOK_REDIRECT_URI: 'https://app.stargaze.cn/api/tiktok/auth/callback',
  TIKTOK_BUSINESS_CLIENT_ID: 'production-business-client',
  TIKTOK_BUSINESS_CLIENT_SECRET: 'production-business-secret-value',
  TIKTOK_BUSINESS_REDIRECT_URI: 'https://app.stargaze.cn/api/tiktok/business-auth/callback/',
  TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT: '20',
  TIKTOK_COMMENT_TOP_LEVEL_CALL_BUDGET: '5',
  TIKTOK_COMMENT_REPLY_CALL_BUDGET: '15',
}

const businessRateEnvLines = [
  'TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT=20',
  'TIKTOK_COMMENT_TOP_LEVEL_CALL_BUDGET=5',
  'TIKTOK_COMMENT_REPLY_CALL_BUDGET=15',
]

test('TikTok production gates remain closed without requiring comment credentials', () => {
  const result = auditTikTokProductionReadiness({
    ...businessEnv,
    SOCIAL_COMMENTS_API_ENABLED: 'false',
    SOCIAL_COMMENTS_ENABLED_PLATFORMS: 'youtube',
    NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED: 'false',
    TIKTOK_COMMENTS_REPLY_ENABLED: 'false',
    NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED: 'false',
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.ok(result.warnings.some((warning) => (
    warning.includes('20260908') && warning.includes('PostgREST schema cache')
  )))
})

test('TikTok video-list scope and UI rollout gates fail closed and must match', () => {
  const defaults = auditTikTokProductionReadiness(businessEnv)
  assert.equal(defaults.ok, true)
  assert.ok(defaults.checks.some((value) => value.includes('both disabled')))

  for (const flags of [
    {
      TIKTOK_VIDEO_LIST_SCOPE_ENABLED: 'false',
      NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED: 'false',
    },
    {
      TIKTOK_VIDEO_LIST_SCOPE_ENABLED: 'true',
      NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED: 'true',
    },
  ]) {
    assert.equal(
      auditTikTokProductionReadiness({ ...businessEnv, ...flags }).ok,
      true,
      JSON.stringify(flags),
    )
  }

  for (const overrides of [
    { TIKTOK_VIDEO_LIST_SCOPE_ENABLED: 'true' },
    { NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED: 'true' },
    {
      TIKTOK_VIDEO_LIST_SCOPE_ENABLED: 'TRUE',
      NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED: 'false',
    },
    {
      TIKTOK_VIDEO_LIST_SCOPE_ENABLED: 'false',
      NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED: 'yes',
    },
    {
      TIKTOK_VIDEO_LIST_SCOPE_ENABLED: ' true ',
      NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED: 'true',
    },
    {
      TIKTOK_VIDEO_LIST_SCOPE_ENABLED: 'true',
      NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED: 'true ',
    },
    {
      TIKTOK_VIDEO_LIST_SCOPE_ENABLED: ' false ',
      NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED: 'false',
    },
    {
      TIKTOK_VIDEO_LIST_SCOPE_ENABLED: '',
      NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED: 'false',
    },
  ]) {
    assert.equal(
      auditTikTokProductionReadiness({ ...businessEnv, ...overrides }).ok,
      false,
      JSON.stringify(overrides),
    )
  }

  const enabled = auditTikTokProductionReadiness({
    ...businessEnv,
    TIKTOK_VIDEO_LIST_SCOPE_ENABLED: 'true',
    NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED: 'true',
  })
  assert.equal(enabled.ok, true)
  assert.ok(enabled.checks.some((value) => value.includes('both enabled')))
  assert.ok(enabled.warnings.some((value) => value.includes('revision with video.list is Live')))

  for (const filename of ['env.example', 'env.template']) {
    const template = fs.readFileSync(filename, 'utf8')
    assert.match(template, /TIKTOK_VIDEO_LIST_SCOPE_ENABLED=false/)
    assert.match(template, /NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED=false/)
  }
})

test('readiness CLI rejects whitespace-padded rollout flags from the process environment', () => {
  const result = childProcess.spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'scripts/tiktok-production-readiness.cjs'),
      '--role=app',
    ],
    {
      encoding: 'utf8',
      env: cleanSpawnEnv({
        ...businessEnv,
        TIKTOK_VIDEO_LIST_SCOPE_ENABLED: ' true ',
        NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED: 'true',
      }),
    },
  )
  assert.equal(result.status, 1)
  assert.match(`${result.stdout}\n${result.stderr}`, /exact literal true or false/)
})

test('ordinary Login Kit credentials and callback are always production-validated', () => {
  const missing = auditTikTokProductionReadiness({
    NEXT_PUBLIC_APP_URL: 'https://app.stargaze.cn/',
  })
  assert.equal(missing.ok, false)
  assert.ok(missing.errors.some((value) => value.includes('TIKTOK_CLIENT_KEY')))
  assert.ok(missing.errors.some((value) => value.includes('TIKTOK_CLIENT_SECRET')))
  assert.ok(missing.errors.some((value) => value.includes('TIKTOK_REDIRECT_URI')))

  const invalidCallbacks = [
    'http://app.stargaze.cn/api/tiktok/auth/callback',
    'https://user:pass@app.stargaze.cn/api/tiktok/auth/callback',
    'https://app.stargaze.cn/api/tiktok/auth/callback?code=leak',
    'https://app.stargaze.cn/api/tiktok/auth/callback#fragment',
    'https://app.stargaze.cn/api/tiktok/business-auth/callback/',
    'https://other.stargaze.cn/api/tiktok/auth/callback',
  ]
  for (const callback of invalidCallbacks) {
    const result = auditTikTokProductionReadiness({
      ...businessEnv,
      TIKTOK_REDIRECT_URI: callback,
    })
    assert.equal(result.ok, false, callback)
  }

  assert.equal(auditTikTokProductionReadiness(businessEnv).ok, true)
})

test('deployment wrapper rejects a cross-environment ordinary Login Kit callback', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-login-kit-env-'))
  try {
    fs.symlinkSync(path.join(process.cwd(), 'scripts'), path.join(directory, 'scripts'), 'dir')
    fs.writeFileSync(path.join(directory, '.env.local'), [
      'NEXT_PUBLIC_SUPABASE_URL=https://supabase.stargaze.cn',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=anon',
      'SUPABASE_SERVICE_ROLE_KEY=service-role',
      'DOUBAO_API_KEY=doubao',
      'DOUBAO_ENDPOINT_ID=endpoint',
      'SORA2_API_KEY=sora',
      'SUCHUANG_API_KEY=suchuang',
      'NEXT_PUBLIC_APP_URL=https://app.stargaze.cn/',
      'TIKTOK_CLIENT_KEY=production-login-client',
      'TIKTOK_CLIENT_SECRET=production-login-secret',
      'TIKTOK_REDIRECT_URI=https://other.stargaze.cn/api/tiktok/auth/callback',
    ].join('\n'))
    const result = childProcess.spawnSync(
      'bash',
      [path.join(process.cwd(), 'deploy/check-env.sh')],
      { cwd: directory, encoding: 'utf8', env: cleanSpawnEnv() },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /TIKTOK_REDIRECT_URI origin must exactly match/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('TikTok public and reply flags fail closed unless their server dependencies are enabled', () => {
  const pageWithoutApi = auditTikTokProductionReadiness({
    ...businessEnv,
    NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED: 'true',
  })
  assert.equal(pageWithoutApi.ok, false)
  assert.ok(pageWithoutApi.errors.some((value) => value.includes('SOCIAL_COMMENTS_API_ENABLED')))

  const uiWithoutServer = auditTikTokProductionReadiness({
    ...businessEnv,
    SOCIAL_COMMENTS_API_ENABLED: 'true',
    SOCIAL_COMMENTS_ENABLED_PLATFORMS: 'youtube,tiktok',
    NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED: 'true',
    TIKTOK_COMMENTS_REPLY_ENABLED: 'false',
    NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED: 'true',
  })
  assert.equal(uiWithoutServer.ok, false)
  assert.ok(uiWithoutServer.errors.some((value) => value.includes('reply UI gate')))
})

test('TikTok comment read budgets are required, numeric, and bounded by the configured QPM', () => {
  const enabled = {
    ...businessEnv,
    SOCIAL_COMMENTS_API_ENABLED: 'true',
    SOCIAL_COMMENTS_ENABLED_PLATFORMS: 'tiktok',
    NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED: 'true',
  }
  for (const overrides of [
    { TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT: '' },
    { TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT: ' 20 ' },
    { TIKTOK_COMMENT_TOP_LEVEL_CALL_BUDGET: '0' },
    { TIKTOK_COMMENT_REPLY_CALL_BUDGET: 'yes' },
    { TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT: '4', TIKTOK_COMMENT_TOP_LEVEL_CALL_BUDGET: '5' },
  ]) {
    assert.equal(
      auditTikTokProductionReadiness({ ...enabled, ...overrides }).ok,
      false,
      JSON.stringify(overrides),
    )
  }
  assert.equal(auditTikTokProductionReadiness(enabled).ok, true)
})

test('a complete direct or broker-backed TikTok rollout passes without exposing values', () => {
  const direct = auditTikTokProductionReadiness({
    ...businessEnv,
    SOCIAL_COMMENTS_API_ENABLED: 'true',
    SOCIAL_COMMENTS_ENABLED_PLATFORMS: 'youtube tiktok',
    NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED: 'true',
    TIKTOK_COMMENTS_REPLY_ENABLED: 'true',
    NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED: 'true',
  })
  assert.equal(direct.ok, true)
  assert.ok(direct.warnings.some((value) => value.includes('reach TikTok Business API directly')))

  const broker = auditTikTokProductionReadiness({
    ...businessEnv,
    SOCIAL_COMMENTS_API_ENABLED: 'true',
    SOCIAL_COMMENTS_ENABLED_PLATFORMS: 'tiktok',
    NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED: 'true',
    TIKTOK_COMMENTS_REPLY_ENABLED: 'true',
    NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED: 'true',
    OAUTH_BROKER_URL: 'https://broker.stargaze.us/',
    BROKER_SECRET: 'a'.repeat(64),
  })
  assert.equal(broker.ok, true)
  const serialized = JSON.stringify(broker)
  assert.equal(serialized.includes('a'.repeat(64)), false)
  assert.equal(serialized.includes(businessEnv.TIKTOK_BUSINESS_CLIENT_SECRET), false)
})

test('broker readiness rejects recursion and validates its network boundary inputs', () => {
  const invalid = auditTikTokProductionReadiness({
    ...businessEnv,
    OAUTH_BROKER_URL: 'https://recursive.example.net',
    BROKER_SECRET: 'short',
  }, 'broker')
  assert.equal(invalid.ok, false)
  assert.ok(invalid.errors.some((value) => value.includes('must be absent')))
  assert.ok(invalid.errors.some((value) => value.includes('at least 32')))

  const valid = auditTikTokProductionReadiness({
    ...businessEnv,
    BROKER_SECRET: 'b'.repeat(64),
    BROKER_PUBLIC_ADDR: '8.8.8.8',
    BROKER_ALLOW_IP: '1.1.1.1',
    BROKER_TLS_PORT: '18443',
    BROKER_LOCAL_PORT: '3101',
    BROKER_UPSTREAM: '127.0.0.1:3101',
  }, 'broker')
  assert.equal(valid.ok, true)
})

test('broker readiness rejects open allowlists, invalid ports, and non-loopback upstreams', () => {
  const base = {
    ...businessEnv,
    BROKER_SECRET: 'b'.repeat(64),
    BROKER_PUBLIC_ADDR: '8.8.8.8',
    BROKER_ALLOW_IP: '1.1.1.1',
    BROKER_TLS_PORT: '18443',
    BROKER_LOCAL_PORT: '3101',
    BROKER_UPSTREAM: '127.0.0.1:3101',
  }
  const invalidCases = [
    { BROKER_PUBLIC_ADDR: 'not-an-ip' },
    { BROKER_PUBLIC_ADDR: 'broker.invalid' },
    { BROKER_PUBLIC_ADDR: 'broker.test' },
    { BROKER_PUBLIC_ADDR: 'broker.example' },
    { BROKER_ALLOW_IP: '0.0.0.0/0' },
    { BROKER_ALLOW_IP: '10.0.0.1' },
    { BROKER_TLS_PORT: 'garbage' },
    { BROKER_LOCAL_PORT: '99999', BROKER_UPSTREAM: '127.0.0.1:99999' },
    { BROKER_UPSTREAM: 'evil.invalid:3101' },
    { BROKER_UPSTREAM: '127.0.0.1:3102' },
  ]
  for (const overrides of invalidCases) {
    const result = auditTikTokProductionReadiness({ ...base, ...overrides }, 'broker')
    assert.equal(result.ok, false, JSON.stringify(overrides))
  }

  const specialIpv6Addresses = [
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.1',
  ]
  for (const address of specialIpv6Addresses) {
    assert.equal(
      auditTikTokProductionReadiness({ ...base, BROKER_ALLOW_IP: address }, 'broker').ok,
      false,
      `allow IP ${address}`,
    )
    assert.equal(
      auditTikTokProductionReadiness({ ...base, BROKER_PUBLIC_ADDR: address }, 'broker').ok,
      false,
      `public address ${address}`,
    )
  }

  const equivalentPublicIpv6 = [
    '2606:4700:4700::1111',
    '2606:4700:4700:0:0:0:0:1111',
  ]
  for (const address of equivalentPublicIpv6) {
    assert.equal(
      auditTikTokProductionReadiness({ ...base, BROKER_ALLOW_IP: address }, 'broker').ok,
      true,
      address,
    )
    assert.equal(
      auditTikTokProductionReadiness({ ...base, BROKER_PUBLIC_ADDR: address }, 'broker').ok,
      false,
      `raw Caddy public address ${address}`,
    )
  }

  const specialPurposeIpv6 = [
    '2001:20::1',
    '2001:2::1',
    '3fff::1',
    '2002:7f00:1::',
  ]
  for (const address of specialPurposeIpv6) {
    assert.equal(
      auditTikTokProductionReadiness({ ...base, BROKER_ALLOW_IP: address }, 'broker').ok,
      false,
      `special-purpose allow IP ${address}`,
    )
  }
})

test('application broker and Business callback URLs reject credential-bearing or inexact targets', () => {
  const base = {
    ...businessEnv,
    SOCIAL_COMMENTS_API_ENABLED: 'true',
    SOCIAL_COMMENTS_ENABLED_PLATFORMS: 'tiktok',
    NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED: 'true',
    BROKER_SECRET: 'c'.repeat(64),
  }
  const invalidBrokerUrls = [
    'https://broker.example.com/',
    'https://user:pass@broker.stargaze.us/',
    'https://broker.stargaze.us/api',
    'https://broker.stargaze.us/?target=other',
    'https://broker.stargaze.us/#fragment',
    'https://127.0.0.1/',
    'https://broker.invalid/',
    'https://broker.test/',
    'https://broker.example/',
  ]
  for (const brokerUrl of invalidBrokerUrls) {
    const result = auditTikTokProductionReadiness({
      ...base,
      OAUTH_BROKER_URL: brokerUrl,
    })
    assert.equal(result.ok, false, brokerUrl)
  }

  const invalidCallbacks = [
    'https://user:pass@app.stargaze.cn/api/tiktok/business-auth/callback/',
    'https://app.stargaze.cn/api/tiktok/business-auth/callback/?leak=1',
    'https://app.stargaze.cn/api/tiktok/business-auth/callback/#fragment',
    'https://other.stargaze.cn/api/tiktok/business-auth/callback/',
  ]
  for (const callbackUrl of invalidCallbacks) {
    const result = auditTikTokProductionReadiness({
      ...base,
      TIKTOK_BUSINESS_REDIRECT_URI: callbackUrl,
    })
    assert.equal(result.ok, false, callbackUrl)
  }

  const loopbackApp = auditTikTokProductionReadiness({
    ...base,
    NEXT_PUBLIC_APP_URL: 'https://localhost/',
    TIKTOK_BUSINESS_REDIRECT_URI: 'https://localhost/api/tiktok/business-auth/callback/',
  })
  assert.equal(loopbackApp.ok, false)

  for (const suffix of ['invalid', 'test', 'example']) {
    const reservedHost = auditTikTokProductionReadiness({
      ...base,
      NEXT_PUBLIC_APP_URL: `https://app.${suffix}/`,
      TIKTOK_BUSINESS_REDIRECT_URI: `https://app.${suffix}/api/tiktok/business-auth/callback/`,
    })
    assert.equal(reservedHost.ok, false, suffix)
  }
})

test('env parser handles comments, export syntax, and quoted values without executing input', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-env-'))
  const filename = path.join(directory, 'readiness.env')
  try {
    fs.writeFileSync(filename, [
      '# comment',
      'export SOCIAL_COMMENTS_API_ENABLED=true',
      'SOCIAL_COMMENTS_ENABLED_PLATFORMS="youtube,tiktok"',
      'BROKER_SECRET="literal-\\$(must-not-run)"',
      'NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=true # inline comment',
      'EMPTY_DOUBLE="" # remains empty',
      "QUOTED_WITH_COMMENT='abc' # strips quotes and comment",
      'MALFORMED_QUOTE="must-fail-closed',
      'UNDEFINED_REFERENCE=$MISSING_VALUE',
      'UNDEFINED_BRACED=${MISSING_VALUE}',
      'EMPTY_BACKTICK=`` # remains empty',
    ].join('\n'))
    const parsed = parseEnvFile(filename)
    assert.equal(parsed.SOCIAL_COMMENTS_API_ENABLED, 'true')
    assert.equal(parsed.SOCIAL_COMMENTS_ENABLED_PLATFORMS, 'youtube,tiktok')
    assert.equal(parsed.BROKER_SECRET, 'literal-$(must-not-run)')
    assert.equal(parsed.NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED, 'true')
    assert.equal(parsed.EMPTY_DOUBLE, '')
    assert.equal(parsed.QUOTED_WITH_COMMENT, 'abc')
    assert.equal(parsed.MALFORMED_QUOTE, '')
    assert.equal(parsed.UNDEFINED_REFERENCE, '')
    assert.equal(parsed.UNDEFINED_BRACED, '')
    assert.equal(parsed.EMPTY_BACKTICK, '')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('deployment env wrapper validates the file as data and never sources shell content', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-deploy-env-'))
  const envFilename = path.join(directory, '.env.local')
  const marker = path.join(directory, 'must-not-exist')
  try {
    fs.symlinkSync(path.join(process.cwd(), 'scripts'), path.join(directory, 'scripts'), 'dir')
    fs.writeFileSync(envFilename, [
      'NEXT_PUBLIC_SUPABASE_URL=https://supabase.stargaze.cn',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=anon',
      'SUPABASE_SERVICE_ROLE_KEY=service-role',
      'DOUBAO_API_KEY=doubao',
      'DOUBAO_ENDPOINT_ID=endpoint',
      'SORA2_API_KEY=sora',
      'SUCHUANG_API_KEY=suchuang',
      'NEXT_PUBLIC_APP_URL=https://app.stargaze.cn/',
      'TIKTOK_CLIENT_KEY=production-login-client',
      'TIKTOK_CLIENT_SECRET=production-login-secret',
      'TIKTOK_REDIRECT_URI=https://app.stargaze.cn/api/tiktok/auth/callback',
      `MALICIOUS=$(touch "${marker}")`,
      'SOCIAL_COMMENTS_API_ENABLED=false',
      'NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=false',
      'TIKTOK_COMMENTS_REPLY_ENABLED=false',
      'NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED=false',
    ].join('\n'))

    const result = childProcess.spawnSync(
      'bash',
      [path.join(process.cwd(), 'deploy/check-env.sh')],
      { cwd: directory, encoding: 'utf8', env: cleanSpawnEnv() },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.existsSync(marker), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('deployment env wrapper rejects an empty quoted required value with an inline comment', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-empty-env-'))
  try {
    fs.symlinkSync(path.join(process.cwd(), 'scripts'), path.join(directory, 'scripts'), 'dir')
    fs.writeFileSync(path.join(directory, '.env.local'), [
      'NEXT_PUBLIC_SUPABASE_URL=https://supabase.stargaze.cn',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY="" # intentionally empty',
      'SUPABASE_SERVICE_ROLE_KEY=$MISSING_SERVICE_ROLE',
      'DOUBAO_API_KEY=`` # dotenv backtick empty',
      'DOUBAO_ENDPOINT_ID=endpoint',
      'SORA2_API_KEY=sora',
      'SUCHUANG_API_KEY=suchuang',
      'NEXT_PUBLIC_APP_URL=https://app.stargaze.cn/',
      'TIKTOK_CLIENT_KEY=production-login-client',
      'TIKTOK_CLIENT_SECRET=production-login-secret',
      'TIKTOK_REDIRECT_URI=https://app.stargaze.cn/api/tiktok/auth/callback',
    ].join('\n'))

    const result = childProcess.spawnSync(
      'bash',
      [path.join(process.cwd(), 'deploy/check-env.sh')],
      { cwd: directory, encoding: 'utf8', env: cleanSpawnEnv() },
    )
    assert.equal(result.status, 1)
    assert.match(result.stdout, /NEXT_PUBLIC_SUPABASE_ANON_KEY/)
    assert.match(result.stdout, /SUPABASE_SERVICE_ROLE_KEY/)
    assert.match(result.stdout, /DOUBAO_API_KEY/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('production readiness CLI rejects unresolved dotenv references as empty runtime values', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-expanded-env-'))
  const filename = path.join(directory, 'app.env')
  try {
    fs.writeFileSync(filename, [
      'SOCIAL_COMMENTS_API_ENABLED=true',
      'SOCIAL_COMMENTS_ENABLED_PLATFORMS=tiktok',
      'NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=true',
      'NEXT_PUBLIC_APP_URL=https://app.stargaze.cn/',
      'TIKTOK_BUSINESS_CLIENT_ID=$MISSING_CLIENT_ID',
      'TIKTOK_BUSINESS_CLIENT_SECRET=${MISSING_CLIENT_SECRET}',
      'TIKTOK_BUSINESS_REDIRECT_URI=https://app.stargaze.cn/api/tiktok/business-auth/callback/',
      ...businessRateEnvLines,
      'OAUTH_BROKER_URL=https://broker.stargaze.us/',
      'BROKER_SECRET=${UNSET_SHARED_SECRET_WITH_A_VERY_LONG_NAME}',
    ].join('\n'))

    const result = childProcess.spawnSync(
      process.execPath,
      ['scripts/tiktok-production-readiness.cjs', '--role=app', `--env=${filename}`],
      { cwd: process.cwd(), encoding: 'utf8', env: cleanSpawnEnv() },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /TIKTOK_BUSINESS_CLIENT_ID/)
    assert.match(result.stderr, /TIKTOK_BUSINESS_CLIENT_SECRET/)
    assert.match(result.stderr, /BROKER_SECRET/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('production readiness CLI validates an env file end to end without printing secrets', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-readiness-'))
  const filename = path.join(directory, 'app.env')
  const brokerSecret = 'broker-secret-that-must-not-be-printed-1234567890'
  const businessSecret = 'business-secret-that-must-not-be-printed'
  try {
    fs.writeFileSync(filename, [
      'SOCIAL_COMMENTS_API_ENABLED=true',
      'SOCIAL_COMMENTS_ENABLED_PLATFORMS=tiktok',
      'NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=true',
      'TIKTOK_COMMENTS_REPLY_ENABLED=true',
      'NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED=true',
      'TIKTOK_BUSINESS_CLIENT_ID=production-business-client',
      `TIKTOK_BUSINESS_CLIENT_SECRET=${businessSecret}`,
      'NEXT_PUBLIC_APP_URL=https://app.stargaze.cn/',
      'TIKTOK_CLIENT_KEY=production-login-client',
      'TIKTOK_CLIENT_SECRET=production-login-secret',
      'TIKTOK_REDIRECT_URI=https://app.stargaze.cn/api/tiktok/auth/callback',
      'TIKTOK_BUSINESS_REDIRECT_URI=https://app.stargaze.cn/api/tiktok/business-auth/callback/',
      ...businessRateEnvLines,
      'OAUTH_BROKER_URL=https://broker.stargaze.us/',
      `BROKER_SECRET=${brokerSecret}`,
    ].join('\n'))

    const result = childProcess.spawnSync(
      process.execPath,
      ['scripts/tiktok-production-readiness.cjs', '--role=app', `--env=${filename}`],
      { cwd: process.cwd(), encoding: 'utf8', env: cleanSpawnEnv() },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /TikTok production readiness: PASS/)
    assert.equal(`${result.stdout}${result.stderr}`.includes(brokerSecret), false)
    assert.equal(`${result.stdout}${result.stderr}`.includes(businessSecret), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('readiness CLI audits shell overrides with the same precedence as Next and Compose', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-shell-env-'))
  const appFilename = path.join(directory, 'app.env')
  const brokerFilename = path.join(directory, 'broker.env')
  try {
    fs.writeFileSync(appFilename, [
      'SOCIAL_COMMENTS_API_ENABLED=false',
      'SOCIAL_COMMENTS_ENABLED_PLATFORMS=youtube',
      'NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=false',
      'TIKTOK_COMMENTS_REPLY_ENABLED=false',
      'NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED=false',
      'OAUTH_BROKER_URL=https://broker.stargaze.us/',
      `BROKER_SECRET=${'a'.repeat(64)}`,
    ].join('\n'))
    const appResult = childProcess.spawnSync(
      process.execPath,
      ['scripts/tiktok-production-readiness.cjs', '--role=app', `--env=${appFilename}`],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: cleanSpawnEnv({
          SOCIAL_COMMENTS_API_ENABLED: 'true',
          SOCIAL_COMMENTS_ENABLED_PLATFORMS: 'tiktok',
          NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED: 'true',
          TIKTOK_COMMENTS_REPLY_ENABLED: 'true',
          NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED: 'true',
          NEXT_PUBLIC_APP_URL: 'https://app.stargaze.cn/',
          TIKTOK_BUSINESS_CLIENT_ID: 'business-client',
          TIKTOK_BUSINESS_CLIENT_SECRET: 'business-secret',
          TIKTOK_BUSINESS_REDIRECT_URI: 'https://app.stargaze.cn/api/tiktok/business-auth/callback/',
          OAUTH_BROKER_URL: 'https://127.0.0.1/',
          BROKER_SECRET: 'b'.repeat(64),
        }),
      },
    )
    assert.equal(appResult.status, 1)
    assert.match(appResult.stderr, /OAUTH_BROKER_URL/)

    fs.writeFileSync(brokerFilename, [
      `BROKER_SECRET=${'c'.repeat(64)}`,
      'TIKTOK_BUSINESS_CLIENT_ID=business-client',
      'TIKTOK_BUSINESS_CLIENT_SECRET=business-secret',
      'TIKTOK_BUSINESS_REDIRECT_URI=https://app.stargaze.cn/api/tiktok/business-auth/callback/',
      'BROKER_PUBLIC_ADDR=8.8.8.8',
      'BROKER_ALLOW_IP=1.1.1.1',
      'BROKER_TLS_PORT=18443',
      'BROKER_LOCAL_PORT=3101',
      'BROKER_UPSTREAM=127.0.0.1:3101',
    ].join('\n'))
    const brokerResult = childProcess.spawnSync(
      process.execPath,
      ['scripts/tiktok-production-readiness.cjs', '--role=broker', `--env=${brokerFilename}`],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: cleanSpawnEnv({ BROKER_ALLOW_IP: '0.0.0.0/0' }),
      },
    )
    assert.equal(brokerResult.status, 1)
    assert.match(brokerResult.stderr, /BROKER_ALLOW_IP/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('app readiness includes lower-priority Next production env files when local keys are absent', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-next-env-'))
  const localFilename = path.join(directory, '.env.local')
  try {
    fs.writeFileSync(localFilename, [
      'OAUTH_BROKER_URL=https://broker.stargaze.us/',
      `BROKER_SECRET=${'e'.repeat(64)}`,
    ].join('\n'))
    fs.writeFileSync(path.join(directory, '.env.production'), [
      'SOCIAL_COMMENTS_API_ENABLED=true',
      'SOCIAL_COMMENTS_ENABLED_PLATFORMS=tiktok',
      'NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=true',
      'NEXT_PUBLIC_APP_URL=https://app.stargaze.cn/',
      'TIKTOK_BUSINESS_CLIENT_ID=business-client',
      'TIKTOK_BUSINESS_CLIENT_SECRET=business-secret',
      'TIKTOK_BUSINESS_REDIRECT_URI=https://other.stargaze.cn/api/tiktok/business-auth/callback/',
      ...businessRateEnvLines,
    ].join('\n'))
    const result = childProcess.spawnSync(
      process.execPath,
      ['scripts/tiktok-production-readiness.cjs', '--role=app', `--env=${localFilename}`],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: cleanSpawnEnv({ NODE_ENV: 'production' }),
      },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /origin must exactly match/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('app readiness always audits production files even when shell NODE_ENV is nonstandard', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-node-env-'))
  const localFilename = path.join(directory, '.env.local')
  try {
    fs.writeFileSync(localFilename, '')
    fs.writeFileSync(path.join(directory, '.env.staging'), [
      'SOCIAL_COMMENTS_API_ENABLED=false',
      'NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=false',
    ].join('\n'))
    fs.writeFileSync(path.join(directory, '.env.production'), [
      'SOCIAL_COMMENTS_API_ENABLED=true',
      'SOCIAL_COMMENTS_ENABLED_PLATFORMS=tiktok',
      'NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=true',
      'NEXT_PUBLIC_APP_URL=https://app.stargaze.cn/',
      'TIKTOK_BUSINESS_CLIENT_ID=business-client',
      'TIKTOK_BUSINESS_CLIENT_SECRET=business-secret',
      'TIKTOK_BUSINESS_REDIRECT_URI=https://other.stargaze.cn/api/tiktok/business-auth/callback/',
      ...businessRateEnvLines,
    ].join('\n'))
    const result = childProcess.spawnSync(
      process.execPath,
      ['scripts/tiktok-production-readiness.cjs', '--role=app', `--env=${localFilename}`],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: cleanSpawnEnv({ NODE_ENV: 'staging' }),
      },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /origin must exactly match/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('broker credential fields stay file-backed while only Compose interpolation uses shell overrides', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-broker-consumers-'))
  const filename = path.join(directory, 'broker.env')
  const lines = (secret) => [
    `BROKER_SECRET=${secret}`,
    'TIKTOK_BUSINESS_CLIENT_ID=business-client',
    'TIKTOK_BUSINESS_CLIENT_SECRET=business-secret',
    'TIKTOK_BUSINESS_REDIRECT_URI=https://app.stargaze.cn/api/tiktok/business-auth/callback/',
    ...businessRateEnvLines,
    'BROKER_PUBLIC_ADDR=8.8.8.8',
    'BROKER_ALLOW_IP=1.1.1.1',
    'BROKER_TLS_PORT=18443',
    'BROKER_LOCAL_PORT=3101',
    'BROKER_UPSTREAM=127.0.0.1:3101',
  ].join('\n')
  try {
    fs.writeFileSync(filename, lines('short'))
    const unsafeFile = childProcess.spawnSync(
      process.execPath,
      ['scripts/tiktok-production-readiness.cjs', '--role=broker', `--env=${filename}`],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: cleanSpawnEnv({ BROKER_SECRET: 'f'.repeat(64) }),
      },
    )
    assert.equal(unsafeFile.status, 1)
    assert.match(unsafeFile.stderr, /BROKER_SECRET/)

    fs.writeFileSync(filename, lines('g'.repeat(64)))
    const safeFile = childProcess.spawnSync(
      process.execPath,
      ['scripts/tiktok-production-readiness.cjs', '--role=broker', `--env=${filename}`],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: cleanSpawnEnv({ BROKER_SECRET: 'short' }),
      },
    )
    assert.equal(safeFile.status, 0, safeFile.stderr)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('broker CLI rejects backtick values that Docker Compose would keep literally', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-compose-env-'))
  const filename = path.join(directory, 'broker.env')
  try {
    fs.writeFileSync(filename, [
      `BROKER_SECRET=\`${'d'.repeat(64)}\``,
      'TIKTOK_BUSINESS_CLIENT_ID=`business-client`',
      'TIKTOK_BUSINESS_CLIENT_SECRET=`business-secret`',
      'TIKTOK_BUSINESS_REDIRECT_URI=`https://app.stargaze.cn/api/tiktok/business-auth/callback/`',
      'BROKER_PUBLIC_ADDR=`8.8.8.8`',
      'BROKER_ALLOW_IP=1.1.1.1',
      'BROKER_TLS_PORT=18443',
      'BROKER_LOCAL_PORT=3101',
      'BROKER_UPSTREAM=127.0.0.1:3101',
    ].join('\n'))
    const result = childProcess.spawnSync(
      process.execPath,
      ['scripts/tiktok-production-readiness.cjs', '--role=broker', `--env=${filename}`],
      { cwd: process.cwd(), encoding: 'utf8', env: cleanSpawnEnv() },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /BROKER_SECRET/)
    assert.match(result.stderr, /BROKER_PUBLIC_ADDR/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('deployment wrapper honors an explicitly empty shell override over a safe file value', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-wrapper-shell-'))
  try {
    fs.symlinkSync(path.join(process.cwd(), 'scripts'), path.join(directory, 'scripts'), 'dir')
    fs.writeFileSync(path.join(directory, '.env.local'), [
      'NEXT_PUBLIC_SUPABASE_URL=https://supabase.stargaze.cn',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=file-anon',
      'SUPABASE_SERVICE_ROLE_KEY=service-role',
      'DOUBAO_API_KEY=doubao',
      'DOUBAO_ENDPOINT_ID=endpoint',
      'SORA2_API_KEY=sora',
      'SUCHUANG_API_KEY=suchuang',
      'NEXT_PUBLIC_APP_URL=https://app.stargaze.cn/',
      'TIKTOK_CLIENT_KEY=production-login-client',
      'TIKTOK_CLIENT_SECRET=production-login-secret',
      'TIKTOK_REDIRECT_URI=https://app.stargaze.cn/api/tiktok/auth/callback',
    ].join('\n'))
    const result = childProcess.spawnSync(
      'bash',
      [path.join(process.cwd(), 'deploy/check-env.sh')],
      {
        cwd: directory,
        encoding: 'utf8',
        env: cleanSpawnEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: '' }),
      },
    )
    assert.equal(result.status, 1)
    assert.match(result.stdout, /NEXT_PUBLIC_SUPABASE_ANON_KEY/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('deployment wrapper uses full Next production file precedence for required values', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-tiktok-wrapper-layers-'))
  const writeBaseLocal = (includeEndpoint) => {
    fs.writeFileSync(path.join(directory, '.env.local'), [
      'NEXT_PUBLIC_SUPABASE_URL=https://supabase.stargaze.cn',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=anon',
      'SUPABASE_SERVICE_ROLE_KEY=service-role',
      'DOUBAO_API_KEY=doubao',
      ...(includeEndpoint ? ['DOUBAO_ENDPOINT_ID=local-endpoint'] : []),
      'SORA2_API_KEY=sora',
      'SUCHUANG_API_KEY=suchuang',
      'NEXT_PUBLIC_APP_URL=https://app.stargaze.cn/',
      'TIKTOK_CLIENT_KEY=production-login-client',
      'TIKTOK_CLIENT_SECRET=production-login-secret',
      'TIKTOK_REDIRECT_URI=https://app.stargaze.cn/api/tiktok/auth/callback',
    ].join('\n'))
  }
  try {
    fs.symlinkSync(path.join(process.cwd(), 'scripts'), path.join(directory, 'scripts'), 'dir')
    writeBaseLocal(true)
    fs.writeFileSync(
      path.join(directory, '.env.production.local'),
      'SUPABASE_SERVICE_ROLE_KEY="" # higher layer must win\n',
    )
    const higherEmpty = childProcess.spawnSync(
      'bash',
      [path.join(process.cwd(), 'deploy/check-env.sh')],
      { cwd: directory, encoding: 'utf8', env: cleanSpawnEnv() },
    )
    assert.equal(higherEmpty.status, 1)
    assert.match(higherEmpty.stdout, /SUPABASE_SERVICE_ROLE_KEY/)

    writeBaseLocal(false)
    fs.writeFileSync(path.join(directory, '.env.production.local'), '')
    fs.writeFileSync(path.join(directory, '.env.production'), 'DOUBAO_ENDPOINT_ID=lower-endpoint\n')
    const lowerFallback = childProcess.spawnSync(
      'bash',
      [path.join(process.cwd(), 'deploy/check-env.sh')],
      { cwd: directory, encoding: 'utf8', env: cleanSpawnEnv() },
    )
    assert.equal(lowerFallback.status, 0, lowerFallback.stderr)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('production runbook locks rollout, rollback, real PostgreSQL, and webhook decisions', () => {
  const runbook = fs.readFileSync('docs/tiktok-production-hardening.md', 'utf8')
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const deployCheck = fs.readFileSync('deploy/check-env.sh', 'utf8')
  const brokerEnv = fs.readFileSync('broker.env.example', 'utf8')
  const brokerCompose = fs.readFileSync('docker-compose.broker.yml', 'utf8')

  assert.match(runbook, /20260723[\s\S]*20260724[\s\S]*20260725[\s\S]*20260726[\s\S]*20260727/)
  assert.match(runbook, /flag-first and non-destructive/)
  assert.match(runbook, /real PostgreSQL staging run remains mandatory/)
  assert.match(runbook, /Do not enable comment webhooks in this release/)
  assert.match(runbook, /preserve the `unknown` action and unique fence/)
  assert.match(runbook, /claim_tiktok_token_refresh\(uuid,text,uuid,integer\)/)
  assert.match(
    runbook,
    /complete_tiktok_business_auth_state\(text,uuid,text,text,text,timestamptz,timestamptz,jsonb\)/,
  )
  assert.match(runbook, /claim_tiktok_business_token_refresh\(uuid,uuid,uuid,uuid,integer\)/)
  assert.match(runbook, /release_tiktok_token_refresh\(uuid,uuid\)/)
  assert.match(
    runbook,
    /commit_tiktok_token_refresh\(uuid,text,uuid,text,text,timestamptz,timestamptz,timestamptz\)/,
  )
  assert.match(runbook, /claim_tiktok_business_auth_state\(text,uuid,integer\)/)
  assert.match(runbook, /fail_tiktok_business_auth_state\(text,uuid,text,text\)/)
  assert.match(
    runbook,
    /commit_tiktok_business_token_refresh\(uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,jsonb\)/,
  )
  assert.match(runbook, /release_tiktok_business_token_refresh\(uuid,uuid,uuid\)/)
  assert.match(runbook, /abandon_stale_tiktok_reply_dispatch\(uuid,uuid,uuid\)/)
  assert.match(runbook, /mark_tiktok_reply_dispatch_started\(uuid,uuid,uuid\)/)
  assert.match(runbook, /has_function_privilege\('service_role'/)
  assert.match(runbook, /function_acl\.grantee = 0/)
  assert.equal(
    packageJson.scripts['check:tiktok-production'],
    'node scripts/tiktok-production-readiness.cjs --role=app --env=.env.local',
  )
  assert.match(deployCheck, /tiktok-production-readiness\.cjs --role=app/)
  assert.doesNotMatch(deployCheck, /source\s+["']?\$ENV_FILE/)
  assert.match(deployCheck, /loadEffectiveEnv/)
  assert.match(brokerEnv, /BROKER_LOCAL_PORT=3101/)
  assert.match(brokerEnv, /BROKER_ALLOW_IP=/)
  assert.doesNotMatch(brokerEnv, /BROKER_HOST_PORT=/)
  assert.match(brokerCompose, /docker compose --env-file broker\.env/)
})

test('Stage 7 keeps legacy aliases and legacy token columns while adding no TikTok webhook route', () => {
  assert.equal(fs.existsSync('src/app/(main)/publish/page.tsx'), true)
  assert.equal(fs.existsSync('src/app/(main)/publish/accounts/page.tsx'), true)
  assert.equal(fs.existsSync('src/app/api/tiktok/webhook/route.ts'), false)

  const legacyMigration = fs.readFileSync(
    'supabase/migrations/20260116_tiktok_publishing.sql',
    'utf8',
  )
  const secureMigration = fs.readFileSync(
    'supabase/migrations/20260723_tiktok_account_tokens.sql',
    'utf8',
  )
  assert.match(legacyMigration, /access_token TEXT/)
  assert.match(legacyMigration, /refresh_token TEXT/)
  assert.doesNotMatch(secureMigration, /DROP COLUMN\s+(?:access_token|refresh_token)/i)
})
