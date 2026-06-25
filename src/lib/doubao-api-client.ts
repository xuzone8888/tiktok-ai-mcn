/**
 * 豆包 API 客户端 - 简化导出版本
 * 
 * 用于其他模块调用豆包 API
 */

// ============================================================================
// 配置
// ============================================================================

const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY || "";
const DOUBAO_API_ENDPOINT = process.env.DOUBAO_API_ENDPOINT || "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const DOUBAO_ENDPOINT_ID = process.env.DOUBAO_ENDPOINT_ID || process.env.ARK_DOUBAO_ENDPOINT_ID || "";

// ============================================================================
// 类型定义
// ============================================================================

interface DoubaoMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

interface DoubaoRequest {
    model: string;
    messages: DoubaoMessage[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
}

interface DoubaoResponse {
    id: string;
    choices: {
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

// ============================================================================
// 辅助函数
// ============================================================================

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 全局请求时间戳
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000;

async function waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        await delay(waitTime);
    }

    lastRequestTime = Date.now();
}

// ============================================================================
// API 函数
// ============================================================================

/**
 * 调用豆包 API (简化版)
 */
export async function callDoubaoAPI(
    messages: DoubaoMessage[],
    options?: {
        maxTokens?: number;
        temperature?: number;
        maxRetries?: number;
    }
): Promise<{ success: boolean; content?: string; error?: string }> {
    const apiKey = DOUBAO_API_KEY;
    const endpointId = DOUBAO_ENDPOINT_ID;
    const maxRetries = options?.maxRetries ?? 3;

    if (!apiKey) {
        return { success: false, error: "豆包 API 密钥未配置，请设置 DOUBAO_API_KEY 或 ARK_API_KEY" };
    }

    if (!endpointId) {
        return { success: false, error: "豆包 Endpoint ID 未配置，请设置 DOUBAO_ENDPOINT_ID 或 ARK_DOUBAO_ENDPOINT_ID" };
    }

    await waitForRateLimit();

    const requestBody: DoubaoRequest = {
        model: endpointId,
        messages,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature || 0.7,
        stream: false,
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log("[Doubao API Client] Calling API:", {
                endpoint: endpointId,
                messageCount: messages.length,
                attempt,
            });

            const response = await fetch(DOUBAO_API_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error("[Doubao API Client] HTTP error:", response.status, errorText);

                if (response.status === 429) {
                    if (attempt < maxRetries) {
                        const retryDelay = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
                        console.log(`[Doubao API Client] Rate limited, retrying in ${retryDelay}ms`);
                        await delay(retryDelay);
                        continue;
                    }
                    return { success: false, error: "API 请求频率过高，请稍后重试" };
                }

                if (response.status >= 500 && attempt < maxRetries) {
                    const retryDelay = 3000 * attempt;
                    await delay(retryDelay);
                    continue;
                }

                return { success: false, error: `API 请求失败: ${response.status}` };
            }

            const data: DoubaoResponse = await response.json();

            if (!data.choices || data.choices.length === 0) {
                return { success: false, error: "API 返回结果为空" };
            }

            const content = data.choices[0].message.content;

            console.log("[Doubao API Client] Success:", {
                contentLength: content.length,
                usage: data.usage,
            });

            return { success: true, content };

        } catch (error) {
            console.error("[Doubao API Client] Error:", error);

            if (attempt < maxRetries) {
                await delay(3000 * attempt);
                continue;
            }

            return {
                success: false,
                error: error instanceof Error ? error.message : "网络请求失败"
            };
        }
    }

    return { success: false, error: "API 请求失败，已达到最大重试次数" };
}
