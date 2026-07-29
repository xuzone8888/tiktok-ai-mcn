#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { get } from 'node:https'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const REQUIRED_BASELINE = 'fea0bcbe73d4a8f670088e4d9878b4e6ceeb49c0'
const FORBIDDEN_SOURCE_REFS = new Set(['codex/broker-runtime-main'])
const EXPECTED_NODE = '24.18.0'
const EXPECTED_NPM = '12.0.1'
const EXPECTED_PACKAGE_MANAGER = `npm@${EXPECTED_NPM}`
const EXPECTED_DOCKER_BASE =
  'FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d'

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz'
const SHEETJS_SHA256 = '8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8'
const SHEETJS_INTEGRITY =
  'sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA=='
const MAX_TARBALL_BYTES = 10 * 1024 * 1024
const REQUEST_IDLE_TIMEOUT_MS = 10_000
const REQUEST_DEADLINE_MS = 30_000

const rootDirectory = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const requireFromProject = createRequire(import.meta.url)

const expectedRootPackages = {
  dependencies: {
    next: '15.5.22',
    react: '19.2.8',
    'react-dom': '19.2.8',
    sharp: '0.35.3',
    xlsx: SHEETJS_URL,
  },
  devDependencies: {
    '@types/node': '24.13.3',
    '@types/react': '19.2.17',
    '@types/react-dom': '19.2.3',
    eslint: '8.57.1',
    'eslint-config-next': '15.5.22',
    postcss: '8.5.24',
    typescript: '5.9.3',
  },
}

const expectedInstalledVersions = {
  ajv: new Set(['6.14.0']),
  'brace-expansion': new Set(['5.0.8']),
  'form-data': new Set(['4.0.6']),
  flatted: new Set(['3.4.2']),
  'js-yaml': new Set(['4.3.0']),
  lodash: new Set(['4.18.1']),
  minimatch: new Set(['3.1.4', '9.0.7']),
  picomatch: new Set(['2.3.2', '4.0.5']),
  postcss: new Set(['8.5.24']),
  qs: new Set(['6.15.3']),
  sharp: new Set(['0.35.3']),
  undici: new Set(['7.29.0']),
  ws: new Set(['8.21.1']),
  xlsx: new Set(['0.20.3']),
}

const expectedInstallScriptPackages = new Map([
  ['@alicloud/openapi-core', '1.0.7'],
  ['fsevents', '2.3.3'],
  ['unrs-resolver', '1.11.1'],
])

function fail(message) {
  throw new Error(`[production-supply-chain] ${message}`)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

function parseArguments(argv) {
  const options = { allowDirty: false }
  for (const argument of argv) {
    if (argument === '--allow-dirty') {
      options.allowDirty = true
      continue
    }
    fail(`unknown argument: ${argument}`)
  }
  return options
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function resolveNpmInvocation() {
  const configuredNpmCli = process.env.STARGAZE_NPM_CLI
  if (configuredNpmCli) {
    if (!configuredNpmCli.startsWith('/') && process.platform !== 'win32') {
      fail('STARGAZE_NPM_CLI must be absolute')
    }
    const npmCli = resolve(configuredNpmCli)
    if (!existsSync(npmCli)) fail('STARGAZE_NPM_CLI does not exist')
    const entry = lstatSync(npmCli)
    if (!entry.isFile() || entry.isSymbolicLink()) {
      fail('STARGAZE_NPM_CLI must be a non-symlink regular file')
    }
    return { command: process.execPath, prefix: [npmCli] }
  }
  if (process.platform !== 'win32') {
    return { command: 'npm', prefix: [] }
  }

  const located = spawnSync('where.exe', ['npm.cmd'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (located.status !== 0) fail('npm.cmd could not be located')

  const checked = []
  for (const rawCandidate of located.stdout.split(/\n/u)) {
    const candidate = rawCandidate.trim()
    if (!candidate) continue
    for (const npmCli of [
      resolve(dirname(candidate), '..', 'npm', 'bin', 'npm-cli.js'),
      resolve(dirname(candidate), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ]) {
      if (!existsSync(npmCli)) continue
      const version = spawnSync(process.execPath, [npmCli, '--version'], {
        encoding: 'utf8',
        windowsHide: true,
      })
      checked.push(`${npmCli}=>${version.stdout.trim() || version.error?.code || version.status}`)
      if (version.status === 0 && version.stdout.trim() === EXPECTED_NPM) {
        return { command: process.execPath, prefix: [npmCli] }
      }
    }
  }
  fail(`the npm CLI paired with PATH could not be resolved (${checked.join(', ')})`)
}

const npmInvocation = resolveNpmInvocation()
const configuredGit = process.env.STARGAZE_GIT_BIN
const gitCommand = configuredGit ? resolve(configuredGit) : 'git'
if (configuredGit) {
  if (!configuredGit.startsWith('/') && process.platform !== 'win32') {
    fail('STARGAZE_GIT_BIN must be absolute')
  }
  if (!existsSync(gitCommand)) fail('STARGAZE_GIT_BIN does not exist')
  const entry = lstatSync(gitCommand)
  if (!entry.isFile() || entry.isSymbolicLink()) {
    fail('STARGAZE_GIT_BIN must be a non-symlink regular file')
  }
}

function run(command, args, label, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDirectory,
    encoding: 'utf8',
    timeout: options.timeout ?? 120_000,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.error) {
    fail(`${label} could not run (${result.error.code ?? 'SPAWN_FAILED'})`)
  }
  return result
}

function runGit(args, label, allowedStatuses = new Set([0])) {
  const result = run(gitCommand, args, label)
  if (!allowedStatuses.has(result.status)) {
    fail(`${label} failed`)
  }
  return result.stdout.trim()
}

function runNpmJson(args, label, requireZeroStatus = true) {
  const result = run(npmInvocation.command, [...npmInvocation.prefix, ...args], label, {
    timeout: 180_000,
    maxBuffer: 128 * 1024 * 1024,
  })
  let payload
  try {
    payload = JSON.parse(result.stdout)
  } catch {
    fail(`${label} did not return JSON`)
  }
  if (requireZeroStatus && result.status !== 0) {
    fail(`${label} failed`)
  }
  return { payload, status: result.status }
}

function packageNameFromLockPath(lockPath) {
  const marker = 'node_modules/'
  const index = lockPath.lastIndexOf(marker)
  return index === -1 ? null : lockPath.slice(index + marker.length)
}

function assertSectionMatches(manifestSection, lockSection, label) {
  const manifestEntries = Object.entries(manifestSection ?? {}).sort(([left], [right]) =>
    left.localeCompare(right)
  )
  const lockEntries = Object.entries(lockSection ?? {}).sort(([left], [right]) =>
    left.localeCompare(right)
  )
  assertEqual(JSON.stringify(lockEntries), JSON.stringify(manifestEntries), label)
}

function verifyManifest(manifest, nvmrc, npmrc) {
  assertEqual(nvmrc.trim(), EXPECTED_NODE, '.nvmrc')
  assertEqual(manifest.packageManager, EXPECTED_PACKAGE_MANAGER, 'package.json packageManager')
  assertEqual(manifest.engines?.node, EXPECTED_NODE, 'package.json Node engine')
  assertEqual(manifest.engines?.npm, EXPECTED_NPM, 'package.json npm engine')
  assertEqual(
    manifest.devEngines?.runtime?.name,
    'node',
    'package.json devEngines.runtime.name'
  )
  assertEqual(
    manifest.devEngines?.runtime?.version,
    EXPECTED_NODE,
    'package.json devEngines.runtime.version'
  )
  assertEqual(
    manifest.devEngines?.runtime?.onFail,
    'error',
    'package.json devEngines.runtime.onFail'
  )
  assertEqual(
    manifest.devEngines?.packageManager?.name,
    'npm',
    'package.json devEngines.packageManager.name'
  )
  assertEqual(
    manifest.devEngines?.packageManager?.version,
    EXPECTED_NPM,
    'package.json devEngines.packageManager.version'
  )
  assertEqual(
    manifest.devEngines?.packageManager?.onFail,
    'error',
    'package.json devEngines.packageManager.onFail'
  )

  const npmEntries = npmrc
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=')
      return separator === -1
        ? [line, '']
        : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
    })
  const expectedNpmEntries = [
    ['engine-strict', 'true'],
    ['save-exact', 'true'],
    ['fund', 'false'],
    ['ignore-scripts', 'true'],
    ['strict-allow-scripts', 'true'],
    ['allow-remote', 'root'],
    ['allow-git', 'none'],
    ['allow-file', 'none'],
    ['allow-directory', 'none'],
  ]
  assertEqual(
    JSON.stringify(npmEntries),
    JSON.stringify(expectedNpmEntries),
    '.npmrc exact policy'
  )
  const npmSettings = new Map(npmEntries)
  assertEqual(npmSettings.get('engine-strict'), 'true', '.npmrc engine-strict')
  assertEqual(npmSettings.get('save-exact'), 'true', '.npmrc save-exact')
  assertEqual(npmSettings.get('ignore-scripts'), 'true', '.npmrc ignore-scripts')
  assertEqual(
    npmSettings.get('strict-allow-scripts'),
    'true',
    '.npmrc strict-allow-scripts'
  )
  assertEqual(npmSettings.get('allow-remote'), 'root', '.npmrc allow-remote')
  assertEqual(npmSettings.get('allow-git'), 'none', '.npmrc allow-git')
  assertEqual(npmSettings.get('allow-file'), 'none', '.npmrc allow-file')
  assertEqual(npmSettings.get('allow-directory'), 'none', '.npmrc allow-directory')
  assertEqual(
    JSON.stringify(manifest.allowScripts),
    JSON.stringify({
      '@alicloud/openapi-core': false,
      fsevents: false,
      'unrs-resolver': false,
    }),
    'package.json denied install scripts'
  )

  for (const [section, packages] of Object.entries(expectedRootPackages)) {
    for (const [name, version] of Object.entries(packages)) {
      assertEqual(manifest[section]?.[name], version, `package.json ${section}.${name}`)
    }
  }

  const overrides = manifest.overrides ?? {}
  assertEqual(overrides['ajv@^6'], '6.14.0', 'ajv override')
  assertEqual(overrides['brace-expansion'], '5.0.8', 'brace-expansion override')
  assertEqual(overrides['flatted@^3'], '3.4.2', 'flatted override')
  assertEqual(overrides['form-data'], '4.0.6', 'form-data override')
  assertEqual(overrides['js-yaml@^4'], '4.3.0', 'js-yaml override')
  assertEqual(overrides.lodash, '4.18.1', 'lodash override')
  assertEqual(overrides['minimatch@^3'], '3.1.4', 'minimatch v3 override')
  assertEqual(overrides['minimatch@^9'], '9.0.7', 'minimatch v9 override')
  assertEqual(overrides.postcss, '8.5.24', 'postcss override')
  assertEqual(overrides.qs, '6.15.3', 'qs override')
  assertEqual(overrides.sharp, '0.35.3', 'sharp override')
  assertEqual(overrides.undici, '7.29.0', 'undici override')
  assertEqual(overrides.ws, '8.21.1', 'ws override')
  assertEqual(overrides.anymatch?.picomatch, '2.3.2', 'anymatch picomatch override')
  assertEqual(overrides.micromatch?.picomatch, '2.3.2', 'micromatch picomatch override')
  assertEqual(overrides.readdirp?.picomatch, '2.3.2', 'readdirp picomatch override')
  assertEqual(overrides.tinyglobby?.picomatch, '4.0.5', 'tinyglobby picomatch override')
}

function verifyLockfile(lockfile, manifest) {
  assertEqual(lockfile.lockfileVersion, 3, 'package-lock.json lockfileVersion')
  const root = lockfile.packages?.['']
  if (!root) fail('package-lock.json is missing the root package entry')

  assertSectionMatches(
    manifest.dependencies,
    root.dependencies,
    'package-lock.json root dependencies'
  )
  assertSectionMatches(
    manifest.devDependencies,
    root.devDependencies,
    'package-lock.json root devDependencies'
  )
  assertEqual(root.engines?.node, EXPECTED_NODE, 'package-lock.json root Node engine')
  assertEqual(root.engines?.npm, EXPECTED_NPM, 'package-lock.json root npm engine')

  const observedVersions = new Map()
  const observedInstallScriptPackages = new Map()
  for (const [lockPath, entry] of Object.entries(lockfile.packages ?? {})) {
    if (!lockPath) continue
    const bundledWithNpm =
      lockPath.startsWith('node_modules/npm/node_modules/') && entry.inBundle === true
    if (bundledWithNpm) continue
    if (typeof entry.resolved !== 'string') {
      fail(`${lockPath} has no immutable resolved source`)
    }
    let resolved
    try {
      resolved = new URL(entry.resolved)
    } catch {
      fail(`${lockPath} has an invalid resolved source`)
    }
    if (
      resolved.protocol !== 'https:' ||
      !['registry.npmjs.org', 'cdn.sheetjs.com'].includes(resolved.hostname)
    ) {
      fail(`${lockPath} resolves from an unapproved source`)
    }
    if (typeof entry.integrity !== 'string' || !entry.integrity.startsWith('sha512-')) {
      fail(`${lockPath} is missing SHA-512 integrity`)
    }

    const name = packageNameFromLockPath(lockPath)
    if (entry.hasInstallScript === true && name) {
      if (observedInstallScriptPackages.has(name)) {
        fail(`${name} has more than one install-script-bearing version`)
      }
      observedInstallScriptPackages.set(name, entry.version)
    }
    if (!name || !(name in expectedInstalledVersions)) continue
    if (!observedVersions.has(name)) observedVersions.set(name, new Set())
    observedVersions.get(name).add(entry.version)
  }

  assertEqual(
    JSON.stringify([...observedInstallScriptPackages].sort()),
    JSON.stringify([...expectedInstallScriptPackages].sort()),
    'install-script-bearing lock entries'
  )

  for (const [name, expected] of Object.entries(expectedInstalledVersions)) {
    const observed = observedVersions.get(name)
    if (!observed?.size) fail(`package-lock.json does not contain ${name}`)
    const unexpected = [...observed].filter((version) => !expected.has(version))
    const missing = [...expected].filter((version) => !observed.has(version))
    if (unexpected.length) {
      fail(`${name} has unapproved locked versions: ${unexpected.join(', ')}`)
    }
    if (missing.length) {
      fail(`${name} is missing approved locked versions: ${missing.join(', ')}`)
    }
  }

  const sheetjs = lockfile.packages?.['node_modules/xlsx']
  assertEqual(sheetjs?.version, '0.20.3', 'locked SheetJS version')
  assertEqual(sheetjs?.resolved, SHEETJS_URL, 'locked SheetJS source')
  assertEqual(sheetjs?.integrity, SHEETJS_INTEGRITY, 'locked SheetJS integrity')
}

function verifyToolchain() {
  assertEqual(process.version, `v${EXPECTED_NODE}`, 'executing Node version')
  const npmVersion = run(
    npmInvocation.command,
    [...npmInvocation.prefix, '--version'],
    'npm version check'
  )
  if (npmVersion.status !== 0) fail('npm version check failed')
  assertEqual(npmVersion.stdout.trim(), EXPECTED_NPM, 'executing npm version')
}

function verifyGit(options) {
  const topLevel = resolve(runGit(['rev-parse', '--show-toplevel'], 'Git root check'))
  assertEqual(topLevel.toLowerCase(), resolve(rootDirectory).toLowerCase(), 'Git root')

  runGit(
    ['merge-base', '--is-ancestor', REQUIRED_BASELINE, 'HEAD'],
    'required production baseline check'
  )
  runGit(['diff', '--check'], 'Git whitespace check')

  const branch = runGit(['branch', '--show-current'], 'Git source ref check')
  if (FORBIDDEN_SOURCE_REFS.has(branch)) {
    fail(`forbidden Canvas source ref: ${branch}`)
  }

  const status = runGit(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    'Git worktree check'
  )
  if (status && !options.allowDirty) {
    fail('Git worktree is dirty')
  }

  return {
    branch: branch || 'detached',
    commit: runGit(['rev-parse', 'HEAD'], 'Git commit check'),
    tree: runGit(['rev-parse', 'HEAD^{tree}'], 'Git tree check'),
    dirty: Boolean(status),
  }
}

function collectInstalledVersions(dependencies, observed) {
  for (const [name, entry] of Object.entries(dependencies ?? {})) {
    if (typeof entry?.version === 'string') {
      if (!observed.has(name)) observed.set(name, new Set())
      observed.get(name).add(entry.version)
    }
    if (name !== 'npm') collectInstalledVersions(entry?.dependencies, observed)
  }
}

function verifyInstalledTree() {
  const { payload } = runNpmJson(['ls', '--all', '--json'], 'npm ls')
  if (Array.isArray(payload.problems) && payload.problems.length) {
    fail('npm ls reported dependency problems')
  }

  const observed = new Map()
  collectInstalledVersions(payload.dependencies, observed)
  for (const [name, expected] of Object.entries(expectedInstalledVersions)) {
    const installed = observed.get(name)
    if (!installed?.size) fail(`installed dependency tree does not contain ${name}`)
    const unexpected = [...installed].filter((version) => !expected.has(version))
    const missing = [...expected].filter((version) => !installed.has(version))
    if (unexpected.length) {
      fail(`${name} has unapproved installed versions: ${unexpected.join(', ')}`)
    }
    if (missing.length) {
      fail(`${name} is missing installed versions: ${missing.join(', ')}`)
    }
  }
}

function verifyRequiredModulesLoad() {
  for (const name of ['@alicloud/openapi-core', 'sharp', 'unrs-resolver', 'xlsx']) {
    try {
      requireFromProject(name)
    } catch (error) {
      fail(`${name} failed to load without dependency lifecycle scripts (${error.code ?? 'ERROR'})`)
    }
  }
}

function verifyDockerfile(dockerfile) {
  assertEqual(
    dockerfile.includes(EXPECTED_DOCKER_BASE),
    true,
    'Dockerfile immutable Node base digest'
  )
  assertEqual(
    dockerfile.includes('COPY package.json package-lock.json .npmrc ./'),
    true,
    'Dockerfile npm policy copy'
  )
  assertEqual(
    dockerfile.includes('npm ci --include=dev --ignore-scripts'),
    true,
    'Dockerfile lifecycle-safe npm ci'
  )
}

function verifyAudit(args, label) {
  const { payload, status } = runNpmJson(args, label, false)
  const vulnerabilities = payload.metadata?.vulnerabilities
  if (!vulnerabilities || typeof vulnerabilities.total !== 'number') {
    fail(`${label} did not return vulnerability metadata`)
  }
  if (status !== 0 || vulnerabilities.total !== 0) {
    fail(`${label} reported vulnerabilities`)
  }
}

function fetchOfficialSheetJsTarball(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (handler, value) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      handler(value)
    }
    const deadline = setTimeout(() => {
      request?.destroy(new Error(`absolute deadline exceeded after ${REQUEST_DEADLINE_MS} ms`))
    }, REQUEST_DEADLINE_MS)

    const request = get(
      url,
      { headers: { 'user-agent': 'stargaze-supply-chain-verifier/2.0' } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          finish(rejectPromise, new Error(`SheetJS download returned HTTP ${response.statusCode}`))
          return
        }

        const declaredLength = Number(response.headers['content-length'])
        if (Number.isFinite(declaredLength) && declaredLength > MAX_TARBALL_BYTES) {
          response.resume()
          finish(
            rejectPromise,
            new Error(`SheetJS tarball exceeds ${MAX_TARBALL_BYTES} bytes`)
          )
          return
        }

        const sha256Hash = createHash('sha256')
        const sha512Hash = createHash('sha512')
        let bytes = 0

        response.on('data', (chunk) => {
          bytes += chunk.length
          if (bytes > MAX_TARBALL_BYTES) {
            request.destroy(new Error(`SheetJS tarball exceeds ${MAX_TARBALL_BYTES} bytes`))
            return
          }
          sha256Hash.update(chunk)
          sha512Hash.update(chunk)
        })
        response.once('aborted', () => {
          finish(rejectPromise, new Error('SheetJS download was aborted'))
        })
        response.once('error', (error) => finish(rejectPromise, error))
        response.once('end', () => {
          if (Number.isFinite(declaredLength) && declaredLength !== bytes) {
            finish(rejectPromise, new Error('SheetJS content length did not match'))
            return
          }
          finish(resolvePromise, {
            bytes,
            sha256: sha256Hash.digest('hex'),
            integrity: `sha512-${sha512Hash.digest('base64')}`,
          })
        })
      }
    )
    request.setTimeout(REQUEST_IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error(`socket idle timeout after ${REQUEST_IDLE_TIMEOUT_MS} ms`))
    })
    request.once('error', (error) => finish(rejectPromise, error))
  })
}

const options = parseArguments(process.argv.slice(2))
const [manifest, lockfile, lockBytes, nvmrc, npmrc, dockerfile] = await Promise.all([
  readJson(new URL('../package.json', import.meta.url)),
  readJson(new URL('../package-lock.json', import.meta.url)),
  readFile(new URL('../package-lock.json', import.meta.url)),
  readFile(new URL('../.nvmrc', import.meta.url), 'utf8'),
  readFile(new URL('../.npmrc', import.meta.url), 'utf8'),
  readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
])

verifyToolchain()
verifyManifest(manifest, nvmrc, npmrc)
verifyLockfile(lockfile, manifest)
verifyDockerfile(dockerfile)
const git = verifyGit(options)
verifyInstalledTree()
verifyRequiredModulesLoad()
verifyAudit(['audit', '--json', '--omit=dev'], 'runtime npm audit')
verifyAudit(['audit', '--json'], 'full npm audit')

const tarball = await fetchOfficialSheetJsTarball(SHEETJS_URL)
assertEqual(tarball.sha256, SHEETJS_SHA256, 'downloaded SheetJS SHA-256')
assertEqual(tarball.integrity, SHEETJS_INTEGRITY, 'downloaded SheetJS SHA-512')

process.stdout.write(
  `${[
    '[production-supply-chain] PASS',
    `commit=${git.commit}`,
    `tree=${git.tree}`,
    `ref=${git.branch}`,
    `dirty=${git.dirty}`,
    `requiredBaseline=${REQUIRED_BASELINE}`,
    `lockSha256=${sha256(lockBytes)}`,
    `node=${EXPECTED_NODE}`,
    `npm=${EXPECTED_NPM}`,
    `sheetjsBytes=${tarball.bytes}`,
  ].join(' ')}\n`
)
