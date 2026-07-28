/**
 * 超级画布数据层 · 离线 TS 载入器(供 verify-canvas-*.mjs 复用)
 *
 * 仓库无测试运行器、也未装 tsx/ts-node,但装了 typescript。本 helper 用
 * `ts.transpileModule` 把请求的 canvas 源文件**连同其真实运行时相对依赖闭包**
 * 逐个剥类型成 ESM,落到 .temp/canvas-verify-build/(gitignored,位于 worktree
 * 内 → 裸 import 的 `zod` 由 worktree node_modules 正常解析),再 dynamic import
 * 交给校验脚本断言。
 *
 * 闭包物化规则(schema.ts 新增运行时依赖 ./generation-intent →
 * ../video-models/{contract,catalog,types} 后,单文件转译已不完备):
 *   - 只跟**转译产物**里剩余的相对说明符递归(类型-only import 已被剥除,
 *     因此恰好等于真实运行时闭包);解析不到源文件立即抛错,绝不静默跳过;
 *   - src/lib/canvas/ 内模块沿用历史扁平名 `<basename>.mjs`,既有脚本的多次
 *     loadCanvasModule 调用约定原样兼容;目录外依赖用 src 相对路径防冲突命名
 *     (如 lib__video-models__types.mjs);输出名冲突一律抛错;
 *   - 每次调用整闭包重物化:干净 .temp、任意门禁顺序都成立,不依赖其他
 *     验证器先跑或残留临时文件。
 *
 * 只依赖已安装的 typescript,全程离线、可重复:`node scripts/verify-canvas-*.mjs`。
 * 仅剥类型不做类型检查——类型正确性由 `npx tsc --noEmit` 单独把关。
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, basename, relative } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_DIR = join(ROOT, "src");
const CANVAS_DIR = join(SRC_DIR, "lib", "canvas");
const OUT_DIR = join(ROOT, ".temp", "canvas-verify-build");

/** 与历史 addExt 相同的说明符匹配面:静态 import/re-export 的相对路径。 */
const RELATIVE_SPECIFIER_RE =
  /(\bfrom\s*|\bimport\s*|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*)(["'])(\.\.?\/[^"']+?)(["'])/g;

/** 解析相对说明符到真实 .ts/.tsx 源文件;解析失败大声报错。 */
function resolveRelativeSource(fromSourcePath, specifier) {
  const base = join(dirname(fromSourcePath), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `canvas-build: 无法解析 ${fromSourcePath} 的相对依赖 "${specifier}"(${base}.ts/.tsx 均不存在)`
  );
}

/** src/lib/canvas 内保持历史扁平名;目录外依赖用 src 相对路径防冲突命名。 */
function outputNameFor(sourcePath) {
  if (dirname(sourcePath) === CANVAS_DIR) {
    return `${basename(sourcePath).replace(/\.tsx?$/i, "")}.mjs`;
  }
  const mangled = relative(SRC_DIR, sourcePath)
    .replace(/\.tsx?$/i, "")
    .split(/[\\/]/)
    .join("__");
  return `${mangled}.mjs`;
}

function transpileSource(ts, sourcePath) {
  const source = readFileSync(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: sourcePath,
  });
  return outputText;
}

/** 物化 sourcePath 及其全部相对运行时依赖,返回本文件的输出文件名。 */
function materialize(ts, sourcePath, nameBySource, sourceByName) {
  const knownName = nameBySource.get(sourcePath);
  if (knownName) return knownName;

  const outName = outputNameFor(sourcePath);
  const owner = sourceByName.get(outName);
  if (owner && owner !== sourcePath) {
    throw new Error(`canvas-build: 输出名冲突 ${outName}(${owner} 与 ${sourcePath})`);
  }
  // 先登记再递归:同调用内重复依赖只物化一次,未来出现依赖环也不会死递归。
  nameBySource.set(sourcePath, outName);
  sourceByName.set(outName, sourcePath);

  const rewritten = transpileSource(ts, sourcePath).replace(
    RELATIVE_SPECIFIER_RE,
    (whole, prefix, quote, specifier) => {
      if (/\.[a-z]+$/i.test(specifier)) return whole; // 已带扩展名的说明符沿用原语义
      const depSource = resolveRelativeSource(sourcePath, specifier);
      const depName = materialize(ts, depSource, nameBySource, sourceByName);
      return `${prefix}${quote}./${depName}${quote}`;
    }
  );
  writeFileSync(join(OUT_DIR, outName), rewritten, "utf8");
  return outName;
}

/**
 * 剥类型并落盘一个 canvas 源文件及其真实运行时依赖闭包,返回可 import() 的模块。
 * @param {string} relFromSrcLibCanvas 如 "doc-limits" 或 "schema"(不含扩展名)
 */
export async function loadCanvasModule(relFromSrcLibCanvas) {
  const ts = require("typescript");
  mkdirSync(OUT_DIR, { recursive: true });

  const srcPath = join(CANVAS_DIR, `${relFromSrcLibCanvas}.ts`);
  const outName = materialize(ts, srcPath, new Map(), new Map());
  // 加 cache-buster 查询串,避免同进程多次 import 命中旧模块缓存。
  return import(`${pathToFileURL(join(OUT_DIR, outName)).href}?t=${Date.now()}`);
}
