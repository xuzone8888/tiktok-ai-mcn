#!/usr/bin/env node
/**
 * App Router 重复路由守卫
 *
 * 背景(2026-09-17):`src/app/page.tsx` 与 `src/app/(landing)/page.tsx` 同时解析到 `/`,
 * Next.js 14 构建期不报错,只在产物里留下两条 app-paths-manifest 记录:
 *   "/page" -> app/page.js          (完整:有 client-reference-manifest + 预渲染 index.html)
 *   "/(landing)/page" -> app/(landing)/page.js  (残缺:两者皆无)
 * 运行时 base-server.js 的 renderPageComponent 取 `appPaths[appPaths.length - 1]`,
 * 正好选中残缺的那条;load-components.js 的 loadClientReferenceManifest 读不到文件时
 * 静默 `return undefined`,于是渲染阶段 `clientReferenceManifest.clientModules` 抛
 * TypeError → 首页 500。GET 走预渲染缓存不受影响,只有绕过缓存的请求(表单 POST /
 * multipart / Next-Action,即 prerender-manifest 里的 experimentalBypassFor)会命中。
 *
 * 本脚本在构建前静态复现 Next 的 normalizeAppPath,任何两个 page/route 文件归一到
 * 同一条 URL 就判失败,防止这类「构建期静默、运行时零星 500」的缺陷再次溜进生产。
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const APP_DIR = join(ROOT, 'src', 'app');
const LEAF = /^(page|route)\.(tsx|ts|jsx|js|mjs)$/;

// 与 next/dist/shared/lib/router/utils/app-paths.ts 的 isGroupSegment 保持一致
const isGroupSegment = (segment) => segment[0] === '(' && segment.endsWith(')');

/** 复刻 next 的 normalizeAppPath:忽略空段、路由组 (x)、并行槽 @x 和末尾的 page/route */
function normalizeAppPath(route) {
  const pathname = route.split('/').reduce((acc, segment, index, segments) => {
    if (!segment) return acc;
    if (isGroupSegment(segment)) return acc;
    if (segment[0] === '@') return acc;
    if ((segment === 'page' || segment === 'route') && index === segments.length - 1) return acc;
    return `${acc}/${segment}`;
  }, '');
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (LEAF.test(entry)) out.push(full);
  }
  return out;
}

const leaves = walk(APP_DIR);
const byRoute = new Map();

for (const file of leaves) {
  const rel = relative(APP_DIR, file).split(sep).join('/');
  const kind = /(^|\/)route\.[a-z]+$/.test(rel) ? 'route' : 'page';
  // 归一时去掉扩展名,交给 normalizeAppPath 处理末尾的 page/route
  const entry = '/' + rel.replace(/\.(tsx|ts|jsx|js|mjs)$/, '');
  const url = normalizeAppPath(entry);
  const key = `${kind} ${url}`;
  if (!byRoute.has(key)) byRoute.set(key, []);
  byRoute.get(key).push(`src/app/${rel}`);
}

const conflicts = [...byRoute.entries()].filter(([, files]) => files.length > 1);

console.log('=== App Router 重复路由检查 ===');
console.log(`扫描 page/route 文件 ${leaves.length} 个,归一出 ${byRoute.size} 条唯一路由。`);
console.log('');

if (conflicts.length === 0) {
  console.log('✅ 无重复路由:每条 URL 只有一个 page/route 文件。');
  process.exit(0);
}

console.log(`❌ 发现 ${conflicts.length} 条 URL 被多个文件占用(Next 构建期不报错,运行时会零星 500):`);
for (const [key, files] of conflicts) {
  const [kind, url] = key.split(' ');
  console.log(`  - [${kind}] ${url}`);
  files.forEach((f) => console.log(`      ${f}`));
}
console.log('');
console.log('修复:删掉多余的那个文件,只保留一个。');
process.exit(1);
