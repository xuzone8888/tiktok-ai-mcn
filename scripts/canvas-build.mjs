/**
 * 超级画布数据层 · 离线 TS 载入器(供 verify-canvas-*.mjs 复用)
 *
 * 仓库无测试运行器、也未装 tsx/ts-node,但装了 typescript。本 helper 用
 * `ts.transpileModule` 把 src/lib/canvas/*.ts **单文件剥类型**成 ESM,落到
 * .temp/canvas-verify-build/(gitignored,位于 worktree 内 → 裸 import 的 `zod`
 * 由 worktree node_modules 正常解析),再 dynamic import 交给校验脚本断言。
 *
 * 只依赖已安装的 typescript,全程离线、可重复:`node scripts/verify-canvas-*.mjs`。
 * 仅剥类型不做类型检查——类型正确性由 `npx tsc --noEmit` 单独把关。
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, basename } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, ".temp", "canvas-verify-build");

/** 给相对 import/export 说明符补 .mjs 扩展(node ESM 需显式扩展);裸包(zod)不动。 */
function addExt(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*)(["'])(\.\.?\/[^"']+?)(["'])/g,
    (m, pre, q1, spec, q2) =>
      /\.[a-z]+$/i.test(spec) ? m : `${pre}${q1}${spec}.mjs${q2}`
  );
}

/**
 * 剥类型并落盘一个 canvas 源文件,返回可 import() 的 file:// URL。
 * @param {string} relFromSrcLibCanvas 如 "doc-limits" 或 "schema"(不含扩展名)
 */
export async function loadCanvasModule(relFromSrcLibCanvas) {
  const ts = require("typescript");
  mkdirSync(OUT_DIR, { recursive: true });

  const srcPath = join(ROOT, "src", "lib", "canvas", `${relFromSrcLibCanvas}.ts`);
  const source = readFileSync(srcPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: srcPath,
  });

  const outPath = join(OUT_DIR, `${basename(relFromSrcLibCanvas)}.mjs`);
  writeFileSync(outPath, addExt(outputText), "utf8");
  // 加 cache-buster 查询串,避免同进程多次 import 命中旧模块缓存。
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`);
}
