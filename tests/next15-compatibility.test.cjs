/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))

function listDynamicRouteFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listDynamicRouteFiles(fullPath)
    return entry.name === 'route.ts' && fullPath.includes(`${path.sep}[`) ? [fullPath] : []
  })
}

test('Next.js 15 security upgrade keeps its lint entrypoint on the ESLint CLI', () => {
  assert.equal(packageJson.dependencies.next, '15.5.24')
  assert.equal(packageJson.devDependencies['eslint-config-next'], '15.5.24')
  assert.doesNotMatch(packageJson.scripts.lint, /next lint/)
  assert.match(packageJson.scripts.lint, /^eslint /)
})

test('dynamic route handlers use asynchronous Next.js 15 params', () => {
  for (const file of listDynamicRouteFiles('src/app/api')) {
    const source = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(
      source,
      /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*\{/,
      `${file} still declares synchronous route params`,
    )
    assert.doesNotMatch(
      source,
      /interface\s+RouteContext\s*\{\s*params\s*:\s*\{/,
      `${file} still declares a synchronous RouteContext`,
    )
  }
})

test('server page search params use the Next.js 15 promise contract', () => {
  const deletionPage = fs.readFileSync('src/app/(landing)/facebook-data-deletion/page.tsx', 'utf8')
  assert.match(deletionPage, /searchParams:\s*Promise<\{ code\?: string \}>/)
  assert.match(deletionPage, /await searchParams/)
})
