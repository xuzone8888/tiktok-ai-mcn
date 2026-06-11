/**
 * API 健康检查 — 后端核心
 * 
 * GET  → 返回 12 个 API 完整状态 + 历史（需 admin 权限）
 * POST → 触发检测（admin 或 cron secret）
 * 
 * 零费用验证方式：
 * - 高瑞/xas231/DeepSeek: GET /v1/models (OpenAI 格式)
 * - ElevenLabs: GET /v1/voices
 * - 速创: 查询不存在的 taskId
 * - 豆包 VLM: 极小 chat (maxTokens=1)
 * - 豆包 TTS: HTTPS 连接 + 配置检查
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

// ============================================================================
// API 配置 — 12 个 API, 8 个域名
// ============================================================================

type ProviderStatus = "online" | "degraded" | "offline" | "unchecked";

interface ApiConfig {
  id: string;
  name: string;
  category: "video" | "image" | "tts" | "text";
  provider: string;        // provider ID for grouping
  domain: string;          // ping target
  envKeys: string[];       // env var names to check
  model?: string;          // API model name
  price?: string;          // unit price display
  verifyMethod: "openai_models" | "elevenlabs_voices" | "suchuang_query" | "doubao_chat" | "tts_connect" | "video_platform_image_config";
}

const API_CONFIGS: ApiConfig[] = [
  // 🎬 视频 (4个)
  {
    id: "suchuang-sora2",
    name: "速创 Sora2",
    category: "video",
    provider: "suchuang",
    domain: "api.wuyinkeji.com",
    envKeys: ["WUYINKEJI_API_KEY"],
    model: "sora2-new 10s/15s",
    price: "¥1.2",
    verifyMethod: "suchuang_query",
  },
  {
    id: "gaorui-veo3-components",
    name: "高瑞 VEO3 参考图版",
    category: "video",
    provider: "gaorui",
    domain: "gaorui.cc",
    envKeys: ["VEO3_GAORUI_API_KEY"],
    model: "veo_3_1-components",
    price: "¥0.40",
    verifyMethod: "openai_models",
  },
  {
    id: "gaorui-veo3-fast",
    name: "高瑞 VEO3 快速版",
    category: "video",
    provider: "gaorui",
    domain: "gaorui.cc",
    envKeys: ["VEO3_GAORUI_API_KEY"],
    model: "veo3.1-fast",
    price: "¥0.25",
    verifyMethod: "openai_models",
  },
  {
    id: "gaorui-veo3-4k",
    name: "高瑞 VEO3 4K超清",
    category: "video",
    provider: "gaorui",
    domain: "gaorui.cc",
    envKeys: ["VEO3_GAORUI_API_KEY"],
    model: "veo3.1-fast-4K",
    price: "¥0.34",
    verifyMethod: "openai_models",
  },
  // 🖼️ 图片 (4个)
  {
    id: "openai-gpt-image-2",
    name: "Video Platform GPT Image 2",
    category: "image",
    provider: "video-platform",
    domain: "api.aixoras.com",
    envKeys: ["VIDEO_PLATFORM_IMAGE_BASE_URL", "VIDEO_PLATFORM_IMAGE_API_KEY"],
    model: "gpt-image-2",
    price: undefined,
    verifyMethod: "video_platform_image_config",
  },
  {
    id: "gaorui-gemini-1k",
    name: "高瑞 Gemini 1K",
    category: "image",
    provider: "gaorui",
    domain: "gaorui.cc",
    envKeys: ["VEO3_GAORUI_API_KEY"],
    model: "gemini-2.5-flash-image",
    price: "¥0.06",
    verifyMethod: "openai_models",
  },
  {
    id: "xas231-gemini-2k",
    name: "xas231 Gemini 2K",
    category: "image",
    provider: "xas231",
    domain: "api.xas231.online",
    envKeys: ["GEMINI_IMAGE_API_KEY"],
    model: "gemini-3.0-pro-image-portrait-2k",
    price: "¥0.085",
    verifyMethod: "openai_models",
  },
  {
    id: "gaorui-gemini-4k",
    name: "高瑞 Gemini 4K",
    category: "image",
    provider: "gaorui",
    domain: "gaorui.cc",
    envKeys: ["VEO3_GAORUI_API_KEY"],
    model: "gemini-3-pro-image-preview",
    price: "¥0.20",
    verifyMethod: "openai_models",
  },
  // 🔊 TTS (2个)
  {
    id: "doubao-tts",
    name: "豆包 TTS",
    category: "tts",
    provider: "doubao",
    domain: "openspeech.bytedance.com",
    envKeys: ["DOUBAO_TTS_ACCESS_KEY", "DOUBAO_TTS_APP_ID"],
    price: undefined,
    verifyMethod: "tts_connect",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    category: "tts",
    provider: "elevenlabs",
    domain: "api.elevenlabs.io",
    envKeys: ["ELEVENLABS_API_KEY"],
    price: undefined,
    verifyMethod: "elevenlabs_voices",
  },
  // 📝 文本 (2个)
  {
    id: "doubao-vlm",
    name: "豆包 VLM",
    category: "text",
    provider: "doubao",
    domain: "ark.cn-beijing.volces.com",
    envKeys: ["DOUBAO_API_KEY"],
    price: undefined,
    verifyMethod: "doubao_chat",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    category: "text",
    provider: "deepseek",
    domain: "api.deepseek.com",
    envKeys: ["DEEPSEEK_API_KEY"],
    price: undefined,
    verifyMethod: "openai_models",
  },
];

// ============================================================================
// 内存历史存储 — 最近 20 条
// ============================================================================

interface CheckRecord {
  timestamp: number;
  results: Record<string, { success: boolean; latencyMs: number; error?: string }>;
}

const MAX_HISTORY = 20;
const checkHistory: CheckRecord[] = [];

// ============================================================================
// 域名去重 — 7 个域名
// ============================================================================

function getUniqueDomains(): Map<string, { domain: string; envKey: string; method: ApiConfig["verifyMethod"] }> {
  const map = new Map<string, { domain: string; envKey: string; method: ApiConfig["verifyMethod"] }>();
  for (const cfg of API_CONFIGS) {
    if (!map.has(cfg.domain)) {
      map.set(cfg.domain, {
        domain: cfg.domain,
        envKey: cfg.envKeys[0],
        method: cfg.verifyMethod,
      });
    }
  }
  return map;
}

// ============================================================================
// 验证函数 — 零费用只读接口
// ============================================================================

async function verifyDomain(
  domain: string,
  envKey: string,
  method: ApiConfig["verifyMethod"]
): Promise<{ success: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  const apiKey = process.env[envKey] || "";
  
  try {
    if (method === "video_platform_image_config") {
      const baseUrl = process.env.VIDEO_PLATFORM_IMAGE_BASE_URL || "";
      const imageApiKey = process.env.VIDEO_PLATFORM_IMAGE_API_KEY || "";
      if (!baseUrl || !imageApiKey) {
        return { success: false, latencyMs: 0, error: "Video Platform 图片配置未完整" };
      }

      try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "https:") {
          return { success: false, latencyMs: 0, error: "VIDEO_PLATFORM_IMAGE_BASE_URL 必须是 HTTPS" };
        }
      } catch {
        return { success: false, latencyMs: 0, error: "VIDEO_PLATFORM_IMAGE_BASE_URL 无效" };
      }

      return { success: true, latencyMs: Date.now() - start };
    }

    // 先检查 Key 是否配置
    if (!apiKey) {
      return { success: false, latencyMs: 0, error: "API Key 未配置" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let response: Response;

    switch (method) {
      case "openai_models": {
        // GET /v1/models — 免费，验证 key + 连通性
        response = await fetch(`https://${domain}/v1/models`, {
          method: "GET",
          headers: { "Authorization": `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const latencyMs = Date.now() - start;
        // 200 = OK, 401 = key invalid, 403 = forbidden
        if (response.ok) {
          return { success: true, latencyMs };
        }
        return { success: false, latencyMs, error: `HTTP ${response.status}` };
      }

      case "elevenlabs_voices": {
        // GET /v1/voices — 免费，验证 key
        response = await fetch(`https://${domain}/v1/voices`, {
          method: "GET",
          headers: { "xi-api-key": apiKey },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const latencyMs = Date.now() - start;
        if (response.ok) {
          return { success: true, latencyMs };
        }
        return { success: false, latencyMs, error: `HTTP ${response.status}` };
      }

      case "suchuang_query": {
        // 查询不存在的 taskId — 免费，验证 key
        response = await fetch(
          `https://${domain}/api/async/detail?key=${apiKey}&id=health_check_test_${Date.now()}`,
          { method: "GET", signal: controller.signal }
        );
        clearTimeout(timeout);
        const latencyMs = Date.now() - start;
        // 速创对无效 taskId 返回 200 + JSON（表示连接正常、key 有效）
        // 如果 key 无效会返回特定错误码
        if (response.ok || response.status === 404) {
          // 能连上并收到响应 = 有效
          try {
            const data = await response.json();
            if (data.code === 401 || data.code === 403 || data.msg?.includes("无效")) {
              return { success: false, latencyMs, error: "Key 无效" };
            }
          } catch {
            // JSON 解析失败也算成功（能连上）
          }
          return { success: true, latencyMs };
        }
        return { success: false, latencyMs, error: `HTTP ${response.status}` };
      }

      case "doubao_chat": {
        // 极小 chat 请求 — 约 2 个 token，≈¥0.000002
        const doubaoEndpoint = process.env.DOUBAO_API_ENDPOINT || 
          "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
        const endpointId = process.env.DOUBAO_ENDPOINT_ID || "";
        
        response = await fetch(doubaoEndpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: endpointId,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const latencyMs = Date.now() - start;
        if (response.ok) {
          return { success: true, latencyMs };
        }
        return { success: false, latencyMs, error: `HTTP ${response.status}` };
      }

      case "tts_connect": {
        // HTTPS 连接测试 + 配置变量检查
        const appId = process.env.DOUBAO_TTS_APP_ID;
        if (!appId) {
          return { success: false, latencyMs: 0, error: "TTS APP_ID 未配置" };
        }
        // 简单 HEAD 请求测试域名可达性（TTS 是 WebSocket 协议，无 REST 只读接口）
        response = await fetch(`https://${domain}`, {
          method: "HEAD",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const latencyMs = Date.now() - start;
        // 任何非网络错误的响应都说明域名可达
        return { success: true, latencyMs };
      }

      default:
        clearTimeout(timeout);
        return { success: false, latencyMs: 0, error: "未知验证方式" };
    }
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : "未知错误";
    if (message.includes("abort")) {
      return { success: false, latencyMs, error: "超时 (8s)" };
    }
    return { success: false, latencyMs, error: message };
  }
}

// ============================================================================
// 执行全量检测
// ============================================================================

async function runHealthCheck(): Promise<CheckRecord> {
  const uniqueDomains = getUniqueDomains();
  
  // 并发检测所有 7 个域名
  const domainResults = new Map<string, { success: boolean; latencyMs: number; error?: string }>();
  
  await Promise.all(
    Array.from(uniqueDomains.entries()).map(async ([domain, config]) => {
      const result = await verifyDomain(domain, config.envKey, config.method);
      domainResults.set(domain, result);
    })
  );

  // 将域名结果映射到每个 API
  const results: Record<string, { success: boolean; latencyMs: number; error?: string }> = {};
  for (const cfg of API_CONFIGS) {
    const domainResult = domainResults.get(cfg.domain);
    if (domainResult) {
      // 额外检查各 API 自身的 Key 是否配置
      const allKeysConfigured = cfg.envKeys.every(k => !!process.env[k]);
      if (!allKeysConfigured) {
        results[cfg.id] = { success: false, latencyMs: 0, error: "Key 未配置" };
      } else {
        results[cfg.id] = domainResult;
      }
    } else {
      results[cfg.id] = { success: false, latencyMs: 0, error: "域名未检测" };
    }
  }

  const record: CheckRecord = { timestamp: Date.now(), results };
  checkHistory.push(record);
  if (checkHistory.length > MAX_HISTORY) {
    checkHistory.shift();
  }

  return record;
}

// ============================================================================
// 状态判定
// ============================================================================

function getStatus(apiId: string): { status: ProviderStatus; successRate: number } {
  if (checkHistory.length === 0) {
    return { status: "unchecked", successRate: 0 };
  }

  const recent = checkHistory.slice(-5);
  const total = recent.length;
  const successes = recent.filter(r => r.results[apiId]?.success).length;
  const rate = Math.round((successes / total) * 100);

  // 全部历史的成功率
  const allSuccesses = checkHistory.filter(r => r.results[apiId]?.success).length;
  const allRate = Math.round((allSuccesses / checkHistory.length) * 100);

  let status: ProviderStatus;
  if (successes === total) {
    status = "online";
  } else if (allRate > 50) {
    status = "degraded";
  } else {
    status = "offline";
  }

  return { status, successRate: allRate };
}

// ============================================================================
// 构建响应数据
// ============================================================================

function buildFullResponse() {
  const apis = API_CONFIGS.map(cfg => {
    const { status, successRate } = getStatus(cfg.id);
    const lastResult = checkHistory.length > 0 
      ? checkHistory[checkHistory.length - 1].results[cfg.id] 
      : null;
    
    return {
      id: cfg.id,
      name: cfg.name,
      category: cfg.category,
      provider: cfg.provider,
      domain: cfg.domain,
      model: cfg.model,
      price: cfg.price,
      status,
      successRate,
      latencyMs: lastResult?.latencyMs ?? 0,
      lastError: lastResult?.error ?? null,
      keyConfigured: cfg.envKeys.every(k => !!process.env[k]),
    };
  });

  const summary = {
    total: apis.length,
    online: apis.filter(a => a.status === "online").length,
    degraded: apis.filter(a => a.status === "degraded").length,
    offline: apis.filter(a => a.status === "offline").length,
    unchecked: apis.filter(a => a.status === "unchecked").length,
    avgLatencyMs: Math.round(
      apis.filter(a => a.latencyMs > 0).reduce((s, a) => s + a.latencyMs, 0) /
      Math.max(1, apis.filter(a => a.latencyMs > 0).length)
    ),
    lastCheckTime: checkHistory.length > 0 ? checkHistory[checkHistory.length - 1].timestamp : null,
    totalChecks: checkHistory.length,
  };

  // 同步到全局变量，供 /status 公开接口读取
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalAny = global as any;
  const providerMap: Record<string, { status: string; rate: number }> = {};
  for (const api of apis) {
    // 每个 provider 取最差状态
    const existing = providerMap[api.provider];
    if (!existing || statusPriority(api.status) > statusPriority(existing.status as ProviderStatus)) {
      providerMap[api.provider] = { status: api.status, rate: api.successRate };
    }
  }
  globalAny.__apiHealthData = {
    providers: providerMap,
    lastCheck: summary.lastCheckTime,
  };

  return { summary, apis };
}

/** 状态优先级：offline > degraded > unchecked > online */
function statusPriority(s: ProviderStatus): number {
  switch (s) {
    case "offline": return 3;
    case "degraded": return 2;
    case "unchecked": return 1;
    case "online": return 0;
  }
}

// ============================================================================
// GET — 返回完整状态（admin 权限）
// ============================================================================

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  return NextResponse.json(buildFullResponse());
}

// ============================================================================
// POST — 触发检测（admin 或 cron secret）
// ============================================================================

export async function POST(req: NextRequest) {
  // 鉴权：admin 或 cron secret
  const cronSecret = req.headers.get("x-cron-secret");
  const envCronSecret = process.env.CRON_SECRET;

  if (cronSecret && envCronSecret && cronSecret === envCronSecret) {
    // cron 调用，合法
  } else {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
  }

  // 执行检测
  const record = await runHealthCheck();
  const response = buildFullResponse();

  return NextResponse.json({
    ...response,
    checkResult: {
      timestamp: record.timestamp,
      results: record.results,
    },
  });
}
