#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const adminRoot = join(root, 'src', 'app', 'api', 'admin')
const apiRoot = join(root, 'src', 'app', 'api')
const explicitlyPublic = new Set([
  'src/app/api/admin/api-health/status/route.ts',
  'src/app/api/admin/set-credits/route.ts',
])

function fail(message) {
  throw new Error(`[admin-api-auth] ${message}`)
}

function walk(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (entry.isFile() && entry.name === 'route.ts') files.push(path)
  }
  return files
}

function projectPath(path) {
  return relative(root, path).replaceAll('\\', '/')
}

function isProtected(source) {
  const usesSharedGuard =
    source.includes('requireAdmin') &&
    source.includes('await requireAdmin()') &&
    source.includes('if (auth.error) return auth.error')
  const usesInlineGuard =
    source.includes('.auth.getUser()') &&
    source.includes('["admin", "super_admin"].includes(profile.role)')
  return usesSharedGuard || usesInlineGuard
}

const adminRoutes = walk(adminRoot).sort()
for (const path of adminRoutes) {
  const name = projectPath(path)
  const source = readFileSync(path, 'utf8')
  if (explicitlyPublic.has(name)) continue
  if (!isProtected(source)) fail(`${name} has no fail-closed administrator guard`)
}

for (const name of explicitlyPublic) {
  const source = readFileSync(join(root, name), 'utf8')
  if (name.endsWith('/set-credits/route.ts') && !source.includes('{ status: 410 }')) {
    fail('the unauthenticated legacy credit endpoint must remain permanently disabled')
  }
  if (
    name.endsWith('/api-health/status/route.ts') &&
    !source.includes('API 健康状态 — 公开接口')
  ) {
    fail('the unauthenticated health status route must remain explicitly documented as public')
  }
}

const moduleScopeServiceClient = /const\s+\w+\s*=\s*createClient\(\s*process\.env\./u
for (const path of walk(apiRoot)) {
  const source = readFileSync(path, 'utf8')
  if (moduleScopeServiceClient.test(source)) {
    fail(`${projectPath(path)} constructs an environment-backed client at module scope`)
  }
}

process.stdout.write(
  `[admin-api-auth] PASS protected=${adminRoutes.length - explicitlyPublic.size} ` +
    `explicitlyPublic=${explicitlyPublic.size}\n`
)
