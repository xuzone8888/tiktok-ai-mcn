/**
 * 门B 拆解基准跑分(S3.2,BLUEPRINT §五红队裁决:20 条真实爆款达标才开 UI)
 *
 * 用法:
 *   node scripts/deconstruct-benchmark.mjs <mp4目录 | urls.txt> [--app http://localhost:3100] [--cleanup]
 *
 *   - mp4目录:目录下所有 .mp4 逐条上传 OSS 后拆解
 *   - urls.txt:每行一个已在本站 OSS 的视频 URL(跳过上传)
 *   - --cleanup:跑完删除基准产生的 blueprints 行(默认保留供人工抽查)
 *
 * 打分维度(自动可测项;台词/分镜准确性需人工抽查 raw 输出):
 *   解析成功 30 分;转录量 10;utterances 时间线质量 15(依据 report.quality
 *   的原始信号:零兜底合成/未乱序/起始时间有区分度/覆盖率≥50%——路由返回的
 *   是消毒后数据,直接检查时间单调必然恒真,审查实锤);
 *   visual_beats(≥2 且描述非空)15;hook(type 枚举+text+rationale≥8字)15;
 *   why_viral(≥2 条)10;CTA 识别 5(只认模型 report.cta,末镜 beat 恒为
 *   cta 属模板保证不算识别)。
 * 达标建议线:解析成功率 ≥90% 且 平均分 ≥80 且 hook 完整率 ≥80%,
 * 外加人工抽查 5 条(台词与画面描述大体准确)——三者都过才开 UI;
 * 样本量 <20 条时报告只作参考,不作开 UI 依据。
 *
 * 账号:s2-acceptance-bot@test.dev(服务角色重置密码);频控 3/分 → 逐条间隔 21s。
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ---------- 参数 ----------
const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
const appFlagIdx = args.indexOf("--app");
const APP_URL = (appFlagIdx !== -1 ? args[appFlagIdx + 1] : "http://localhost:3100").replace(/\/$/, "");
const CLEANUP = args.includes("--cleanup");
if (!input) {
  console.error("用法: node scripts/deconstruct-benchmark.mjs <mp4目录|urls.txt> [--app URL] [--cleanup]");
  process.exit(1);
}

// ---------- env ----------
const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const OSS_DOMAIN = env.ALIYUN_OSS_CUSTOM_DOMAIN;
const REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const EMAIL = "s2-acceptance-bot@test.dev";
const PASSWORD = "S32-bench-" + Math.random().toString(36).slice(2, 10);
const adminHeaders = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

// ---------- OSS 直传(本地脚本持 env key,直接 SDK put) ----------
function createOssClient() {
  const OSS = require("ali-oss");
  return new OSS({
    region: env.ALIYUN_OSS_REGION || "oss-cn-beijing",
    accessKeyId: env.ALIYUN_OSS_ACCESS_KEY_ID,
    accessKeySecret: env.ALIYUN_OSS_ACCESS_KEY_SECRET,
    bucket: env.ALIYUN_OSS_BUCKET,
    endpoint: env.ALIYUN_OSS_ENDPOINT || "https://oss-cn-beijing.aliyuncs.com",
    secure: true,
    timeout: 600000,
  });
}

async function collectVideoUrls() {
  const stat = fs.statSync(input);
  if (stat.isFile()) {
    return fs
      .readFileSync(input, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//.test(l))
      .map((url) => ({ name: url.split("/").pop(), url }));
  }
  const files = fs
    .readdirSync(input)
    .filter((f) => f.toLowerCase().endsWith(".mp4"))
    .sort();
  if (files.length === 0) throw new Error("目录里没有 .mp4 文件");
  const client = createOssClient();
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const local = path.join(input, f);
    const sizeMB = (fs.statSync(local).size / 1024 / 1024).toFixed(1);
    const key = `videos/benchmark/${Date.now()}-${i}-${f.replace(/[^\w.-]/g, "_")}`;
    process.stdout.write(`上传 ${f} (${sizeMB}MB) ... `);
    let uploaded = false;
    for (let attempt = 0; attempt < 2 && !uploaded; attempt++) {
      try {
        await client.put(key, local, { headers: { "Content-Type": "video/mp4" } });
        uploaded = true;
      } catch (e) {
        if (attempt === 0) {
          process.stdout.write(`重试(${e.message.slice(0, 60)}) ... `);
          await new Promise((r) => setTimeout(r, 5000));
        } else {
          // 单条上传失败不作废整跑:记为 upload-failed 继续
          console.log("FAIL,跳过");
          out.push({ name: f, url: null, ossKey: null, uploadError: e.message.slice(0, 120) });
        }
      }
    }
    if (uploaded) {
      console.log("OK");
      out.push({ name: f, url: `https://${OSS_DOMAIN}/${key}`, ossKey: key });
    }
  }
  return out;
}

// ---------- 登录 ----------
async function login() {
  const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: adminHeaders });
  const usersBody = await usersRes.json();
  const users = usersBody.users || usersBody;
  const testUser = (Array.isArray(users) ? users : []).find((u) => u.email === EMAIL);
  if (!testUser) throw new Error("测试账号不存在: " + EMAIL);
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${testUser.id}`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ password: PASSWORD }),
  });
  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const session = await loginRes.json();
  if (!session.access_token) throw new Error("登录失败: " + JSON.stringify(session).slice(0, 200));
  const raw = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const cookies = [];
  if (raw.length <= 3180) cookies.push(`sb-${REF}-auth-token=${raw}`);
  else for (let i = 0; i * 3180 < raw.length; i++) cookies.push(`sb-${REF}-auth-token.${i}=${raw.slice(i * 3180, (i + 1) * 3180)}`);
  return cookies.join("; ");
}

// ---------- 打分 ----------
const HOOK_TYPES = ["痛点", "悬念", "对比", "场景"];

/**
 * 时间线质量(15 分):路由返回的是消毒后数据(已排序/已兜底),直接检查
 * 单调恒真——必须看 report.quality 的原始信号(解析器在消毒时统计):
 * 满分 = ≥2 句 且 零时间兜底 且 未乱序 且 起始时间有区分度 且 覆盖率≥50%
 */
function scoreTimeline(r) {
  const utts = Array.isArray(r.utterances) ? r.utterances : [];
  if (utts.length === 0) return 0;
  const q = r.quality || {};
  const clean =
    utts.length >= 2 &&
    (q.missing_time_count ?? 99) === 0 &&
    q.reordered !== true &&
    (q.distinct_start_count ?? 0) >= Math.min(utts.length, 2) &&
    (q.utterance_coverage ?? 0) >= 0.5;
  if (clean) return 15;
  // 有台词但时间线有瑕疵(兜底/乱序/覆盖不足):部分分
  return utts.length >= 2 ? 7 : 4;
}

function scoreOne(ok, data) {
  const detail = {};
  let score = 0;
  detail.parse = ok ? 30 : 0;
  score += detail.parse;
  if (!ok || !data) return { score, detail };
  const r = data.report;
  detail.transcript = (r.transcript_full || "").length >= 40 ? 10 : (r.transcript_full || "").length >= 15 ? 5 : 0;
  detail.utterances = scoreTimeline(r);
  detail.beats =
    Array.isArray(r.visual_beats) && r.visual_beats.length >= 2 &&
    r.visual_beats.every((b) => b.description && b.description.length >= 10) ? 15
      : Array.isArray(r.visual_beats) && r.visual_beats.length >= 1 ? 7 : 0;
  detail.hook =
    r.hook && HOOK_TYPES.includes(r.hook.type) && r.hook.text && (r.hook.rationale || "").length >= 8 ? 15
      : r.hook && r.hook.text ? 8 : 0;
  detail.why_viral = Array.isArray(r.why_viral) && r.why_viral.length >= 2 ? 10 : r.why_viral?.length === 1 ? 5 : 0;
  // 只认模型自己识别的 CTA(scenes 末镜 beat 恒为 cta 属模板保证,不算识别——审查实锤)
  detail.cta = r.cta && r.cta.text ? 5 : 0;
  score = Object.values(detail).reduce((a, b) => a + b, 0);
  return { score, detail };
}

// ---------- 主流程 ----------
async function main() {
  console.log(`APP = ${APP_URL} | 输入 = ${input}`);
  const videos = await collectVideoUrls();
  console.log(`共 ${videos.length} 条视频进入基准`);
  const cookieHeader = await login();

  const outDir = path.join(".temp", "deconstruct-benchmark", String(Date.now()));
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    if (!v.url) {
      // 上传失败的条目:计为 FAIL 但不打路由
      results.push({ name: v.name, url: null, ok: false, elapsed: 0, score: 0, detail: { parse: 0 }, error: `上传失败:${v.uploadError}`, blueprintId: null });
      continue;
    }
    if (i > 0) {
      process.stdout.write("(频控间隔 21s)\n");
      await new Promise((r) => setTimeout(r, 21_000));
    }
    process.stdout.write(`[${i + 1}/${videos.length}] 拆解 ${v.name} ... `);
    const t0 = Date.now();
    let ok = false, data = null, error = "";
    try {
      const res = await fetch(`${APP_URL}/api/studio/deconstruct`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        body: JSON.stringify({ videoUrl: v.url, rightsAck: true, title: `benchmark:${v.name}` }),
        // 必须 ≥ 服务端最坏时长(qwen 135s×2+退避+落库≈280s):客户端先掐会把
        // 慢而成功的条目记 FAIL,且服务端并发闸仍被占,级联冤杀后续条目(审查实锤)
        signal: AbortSignal.timeout(420_000),
      });
      const body = await res.json();
      ok = res.ok && body.success && !!body.data?.report;
      data = body.data ?? null;
      if (!ok) error = body.error || `HTTP ${res.status}`;
    } catch (e) {
      error = e.message;
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const { score, detail } = scoreOne(ok, data);
    console.log(`${ok ? "OK" : "FAIL"} ${elapsed}s 得分 ${score}${error ? " | " + error.slice(0, 120) : ""}`);
    results.push({ name: v.name, url: v.url, ok, elapsed: Number(elapsed), score, detail, error, blueprintId: data?.blueprintId ?? null });
    fs.writeFileSync(path.join(outDir, `${String(i).padStart(2, "0")}-${v.name.replace(/[^\w.-]/g, "_")}.json`), JSON.stringify({ video: v, ok, error, data }, null, 2));
  }

  // ---------- 汇总 ----------
  const parsed = results.filter((r) => r.ok);
  const parseRate = parsed.length / results.length;
  const avgScore = results.reduce((a, r) => a + r.score, 0) / results.length;
  const hookRate = results.filter((r) => r.detail.hook === 15).length / results.length;
  const pass = parseRate >= 0.9 && avgScore >= 80 && hookRate >= 0.8;
  const sampleNote =
    results.length < 20 ? `(⚠️ 样本量 ${results.length} < 20,仅作参考,不作开 UI 依据)` : "";

  const md = [
    `# 门B 拆解基准报告(${new Date().toISOString()})`,
    "",
    `- 视频数:${results.length}${sampleNote}`,
    `- 解析成功率:${(parseRate * 100).toFixed(0)}%(线 ≥90%)`,
    `- 平均分:${avgScore.toFixed(1)}(线 ≥80)`,
    `- hook 完整率:${(hookRate * 100).toFixed(0)}%(线 ≥80%)`,
    `- **自动判定:${pass ? `PASS${sampleNote}(仍需人工抽查 5 条 raw 输出确认台词/分镜准确)` : "FAIL(不开 UI)"}**`,
    "",
    "| # | 视频 | 结果 | 耗时 | 分 | parse/转录/句/镜/hook/why/cta | 错误 |",
    "|---|---|---|---|---|---|---|",
    ...results.map((r, i) =>
      `| ${i + 1} | ${r.name} | ${r.ok ? "✓" : "✗"} | ${r.elapsed}s | ${r.score} | ${r.detail.parse ?? 0}/${r.detail.transcript ?? 0}/${r.detail.utterances ?? 0}/${r.detail.beats ?? 0}/${r.detail.hook ?? 0}/${r.detail.why_viral ?? 0}/${r.detail.cta ?? 0} | ${(r.error || "").slice(0, 60)} |`
    ),
    "",
    `raw 输出:${outDir}/*.json(人工抽查台词与分镜描述准确性)`,
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "report.md"), md);
  console.log("\n" + md);

  // ---------- 清理 ----------
  if (CLEANUP) {
    // 按 title 前缀兜底删除(客户端超时丢失 blueprintId 的行也能删——审查实锤)
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/blueprints?source_type=eq.reference_video&source_ref->>title=like.benchmark:*`,
      { method: "DELETE", headers: adminHeaders }
    );
    console.log("已清理基准 blueprints 行:", delRes.status);
    // 基准上传的 OSS 对象一并清
    const keys = videos.filter((v) => v.ossKey).map((v) => v.ossKey);
    if (keys.length > 0) {
      const client = createOssClient();
      for (const key of keys) {
        await client.delete(key).catch(() => {});
      }
      console.log(`已清理基准 OSS 对象 ${keys.length} 个`);
    }
  } else {
    console.log("基准 blueprints 行与 OSS 对象已保留(--cleanup 可删)");
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
