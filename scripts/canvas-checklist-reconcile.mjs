#!/usr/bin/env node
/**
 * 超级画布 checklist 对账脚本(机器级零遗漏守卫)
 *
 * 用途:
 *   1. 解析 docs/SUPER_CANVAS_CHECKLIST.md 所有功能表,按「裁决/期次」计数;
 *      与文内两张统计表(各组裁决计数 / 期次分布)逐格核对——任何漂移立即报错。
 *   2. 把「做 且 期次起始=P0」的功能点(以 功能点列原文为唯一键)与
 *      docs/SUPER_CANVAS_P0_BOARD.md 的《P0 功能点覆盖清单》逐键机器比对,
 *      确保一一对应、零遗漏、零虚列。
 *   3. 轻校 CLAUDE.md / 看板头 声明的 P0 总数与实际计算一致。
 *
 * 运行:node scripts/canvas-checklist-reconcile.mjs        (对账,失败退出码 1)
 *       node scripts/canvas-checklist-reconcile.mjs --list-p0   (打印 P0 功能点键,一行一个)
 *
 * 期次归一规则:取期次单元格中第一个出现的 P0-P4 作为「起始期」。
 *   例:'P0 起'→P0、'P1/P2'→P1、'P2 批量/P3 合成'→P2、'P3-P4'→P3、'P2 评估'→P2。
 *   无 P 匹配(如 '按需'、'—')不计入任何期次的「做」分布。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHECKLIST = join(ROOT, 'docs', 'SUPER_CANVAS_CHECKLIST.md');
const BOARD = join(ROOT, 'docs', 'SUPER_CANVAS_P0_BOARD.md');
const CLAUDE = join(ROOT, 'CLAUDE.md');

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const splitRow = (line) => {
  // 去掉行首尾的 | 后按 | 切分;markdown 单元格内不允许裸 |,故安全
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => c.trim());
};
const isSep = (cells) => cells.every((c) => /^:?-{2,}:?$/.test(c));
const startPhase = (phaseRaw) => {
  const m = phaseRaw.match(/P([0-4])/);
  return m ? `P${m[1]}` : null;
};

// ---- 解析 CHECKLIST 功能表 ----
function parseChecklist(md) {
  const lines = md.split(/\r?\n/);
  let group = null;          // 'A'..'G'
  let inFeatureTable = false;
  let colIdx = null;         // {feat,decision,phase}
  const rows = [];
  const errors = [];

  for (const line of lines) {
    const h = line.match(/^##\s+([A-G])\.\s/);
    if (h) { group = h[1]; inFeatureTable = false; colIdx = null; continue; }
    if (!line.trim().startsWith('|')) { inFeatureTable = false; colIdx = null; continue; }

    const cells = splitRow(line);
    if (isSep(cells)) continue;

    // 表头:含 功能点 且 裁决 且 期次 → 进入功能表
    if (cells.includes('功能点') && cells.includes('裁决') && cells.includes('期次')) {
      colIdx = {
        feat: cells.indexOf('功能点'),
        decision: cells.indexOf('裁决'),
        phase: cells.indexOf('期次'),
      };
      inFeatureTable = true;
      continue;
    }
    if (!inFeatureTable || !colIdx) continue;

    const feat = norm(cells[colIdx.feat] ?? '');
    const decision = norm(cells[colIdx.decision] ?? '');
    const phaseRaw = norm(cells[colIdx.phase] ?? '');
    if (!feat) continue;
    if (!['做', '裁', '延'].includes(decision)) {
      errors.push(`未知裁决值「${decision}」:${feat}`);
      continue;
    }
    rows.push({ group, feat, decision, phaseRaw, phase: startPhase(phaseRaw) });
  }
  return { rows, errors };
}

// 解析文内「各组裁决计数」表 → {A:{做,裁,延,合计},...,合计:{...}}
function parseGroupStat(md) {
  const out = {};
  for (const line of md.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = splitRow(line).map((c) => c.replace(/\*\*/g, '').trim());
    const gm = cells[0].match(/^([A-G])\.\s/);
    const isTotal = cells[0] === '合计';
    if (!gm && !isTotal) continue;
    if (cells.length < 5) continue;
    const nums = cells.slice(1, 5).map((n) => Number(n));
    if (nums.some((n) => Number.isNaN(n))) continue;
    const key = isTotal ? '合计' : gm[1];
    out[key] = { 做: nums[0], 裁: nums[1], 延: nums[2], 合计: nums[3] };
  }
  return out;
}

// 解析文内「期次分布」表 → {P0:n,...}
function parsePhaseStat(md) {
  const out = {};
  for (const line of md.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = splitRow(line).map((c) => c.replace(/\*\*/g, '').trim());
    const pm = cells[0].match(/^P([0-4])$/);
    if (!pm) continue;
    const n = Number(cells[1]);
    if (Number.isNaN(n)) continue;
    out[`P${pm[1]}`] = n;
  }
  return out;
}

// 解析看板《P0 功能点覆盖清单》表(表头含「原文键」)
function parseBoardCoverage(md) {
  const lines = md.split(/\r?\n/);
  let inTable = false;
  let colIdx = null;
  const rows = [];
  for (const line of lines) {
    if (!line.trim().startsWith('|')) { inTable = false; colIdx = null; continue; }
    const cells = splitRow(line);
    if (isSep(cells)) continue;
    const keyCol = cells.findIndex((c) => c.includes('原文键'));
    const taskCol = cells.findIndex((c) => c.includes('任务'));
    if (keyCol >= 0 && taskCol >= 0) {
      inTable = true; colIdx = { key: keyCol, task: taskCol }; continue;
    }
    if (!inTable || !colIdx) continue;
    const key = norm(cells[colIdx.key] ?? '');
    const task = norm(cells[colIdx.task] ?? '');
    if (key) rows.push({ key, task });
  }
  return rows;
}

// ---- 主流程 ----
const checklistMd = readFileSync(CHECKLIST, 'utf8');
const { rows, errors: parseErrors } = parseChecklist(checklistMd);

// 计算各组 & 期次
const groups = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const calcGroup = {};
for (const g of groups) calcGroup[g] = { 做: 0, 裁: 0, 延: 0, 合计: 0 };
const calcPhase = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
for (const r of rows) {
  calcGroup[r.group][r.decision]++;
  calcGroup[r.group]['合计']++;
  if (r.decision === '做' && r.phase) calcPhase[r.phase]++;
}
const calcTotal = { 做: 0, 裁: 0, 延: 0, 合计: 0 };
for (const g of groups) for (const k of ['做', '裁', '延', '合计']) calcTotal[k] += calcGroup[g][k];

const p0Keys = rows.filter((r) => r.decision === '做' && r.phase === 'P0').map((r) => r.feat);

if (process.argv.includes('--list-p0')) {
  p0Keys.forEach((k) => console.log(k));
  process.exit(0);
}

const problems = [];
parseErrors.forEach((e) => problems.push(`[解析] ${e}`));

// 校验 1:各组统计表
const statGroup = parseGroupStat(checklistMd);
for (const g of groups) {
  const s = statGroup[g];
  const c = calcGroup[g];
  if (!s) { problems.push(`[各组统计] 缺组 ${g}`); continue; }
  for (const k of ['做', '裁', '延', '合计']) {
    if (s[k] !== c[k]) problems.push(`[各组统计] ${g} 组 ${k}:表=${s[k]} 实=${c[k]}`);
  }
}
if (statGroup['合计']) {
  for (const k of ['做', '裁', '延', '合计']) {
    if (statGroup['合计'][k] !== calcTotal[k]) {
      problems.push(`[各组统计] 合计 ${k}:表=${statGroup['合计'][k]} 实=${calcTotal[k]}`);
    }
  }
} else problems.push('[各组统计] 缺合计行');

// 校验 2:期次分布表
const statPhase = parsePhaseStat(checklistMd);
for (const p of ['P0', 'P1', 'P2', 'P3', 'P4']) {
  if (statPhase[p] === undefined) { problems.push(`[期次分布] 缺 ${p}`); continue; }
  if (statPhase[p] !== calcPhase[p]) problems.push(`[期次分布] ${p}:表=${statPhase[p]} 实=${calcPhase[p]}`);
}

// 校验 3:看板 P0 覆盖清单一一对应
const boardMd = readFileSync(BOARD, 'utf8');
const coverage = parseBoardCoverage(boardMd);
const p0Set = new Set(p0Keys);
const covSet = new Set(coverage.map((c) => c.key));
if (coverage.length === 0) problems.push('[看板覆盖] 未找到《P0 功能点覆盖清单》表(表头需含「原文键」)');
// 重复键
const seen = new Set();
for (const c of coverage) {
  if (seen.has(c.key)) problems.push(`[看板覆盖] 重复键:${c.key}`);
  seen.add(c.key);
}
// 缺失(checklist 有,看板无)
for (const k of p0Set) if (!covSet.has(k)) problems.push(`[看板覆盖] 缺 P0 功能点:${k}`);
// 虚列(看板有,checklist 无此 P0 键)
for (const k of covSet) if (!p0Set.has(k)) problems.push(`[看板覆盖] 看板列了非 P0 功能点(键不匹配 checklist):${k}`);
// 任务 ID 须存在于状态总览
const statusIds = new Set();
for (const line of boardMd.split(/\r?\n/)) {
  const m = line.match(/^\|\s*([A-Z]\d+)\s+/);
  if (m) statusIds.add(m[1]);
}
for (const c of coverage) {
  const ids = c.task.match(/[A-Z]\d+/g) || []; // 多任务映射(如 D2+S6)校验每一个
  if (ids.length === 0) { problems.push(`[看板覆盖] 键「${c.key}」未标任务`); continue; }
  for (const id of ids) {
    if (!statusIds.has(id)) problems.push(`[看板覆盖] 键「${c.key}」的任务 ${id} 不在状态总览`);
  }
}

// 校验 4:文档声明的 P0 总数
const p0Count = calcPhase.P0;
const claudeMd = readFileSync(CLAUDE, 'utf8');
const claudeClaim = claudeMd.match(/画布骨架\s*(\d+)\s*功能点/);
if (!claudeClaim) problems.push('[CLAUDE.md] 未找到「画布骨架 N 功能点」声明');
else if (Number(claudeClaim[1]) !== p0Count) problems.push(`[CLAUDE.md] P0 声明=${claudeClaim[1]} 实=${p0Count}`);
const boardClaim = boardMd.match(/全部\s*(\d+)\s*个\s*P0/);
if (!boardClaim) problems.push('[看板头] 未找到「全部 N 个 P0」声明');
else if (Number(boardClaim[1]) !== p0Count) problems.push(`[看板头] P0 声明=${boardClaim[1]} 实=${p0Count}`);

// ---- 报告 ----
console.log('=== 超级画布 checklist 对账 ===');
console.log(`功能行总数:${rows.length}(做 ${calcTotal.做} / 裁 ${calcTotal.裁} / 延 ${calcTotal.延})`);
console.log(`做·期次分布:P0=${calcPhase.P0} P1=${calcPhase.P1} P2=${calcPhase.P2} P3=${calcPhase.P3} P4=${calcPhase.P4}`);
console.log(`P0 功能点(唯一键)=${p0Keys.length};看板覆盖清单=${coverage.length}`);
console.log('');
if (problems.length === 0) {
  console.log('✅ 全部一致:统计表自洽、P0 功能点与看板一一对应、文档声明数一致。');
  process.exit(0);
} else {
  console.log(`❌ 发现 ${problems.length} 处不一致:`);
  problems.forEach((p) => console.log('  - ' + p));
  process.exit(1);
}
