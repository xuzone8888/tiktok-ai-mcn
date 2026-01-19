/**
 * URL 可用性检测 API
 * 
 * 服务端检测 URL 是否可访问（避免客户端 no-cors opaque 问题）
 * 返回准确的 HTTP 状态码
 * 
 * POST /api/upload/check-url
 * Body: { url: string }
 * Returns: { accessible: boolean, status?: number, reason?: string }
 */

import { NextRequest, NextResponse } from "next/server"

export const runtime = 'nodejs'
export const maxDuration = 10 // 10 seconds timeout

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { url } = body

        if (!url) {
            return NextResponse.json(
                { accessible: false, reason: "缺少 URL" },
                { status: 400 }
            )
        }

        // Validate URL format
        try {
            new URL(url)
        } catch {
            return NextResponse.json(
                { accessible: false, reason: "无效的 URL 格式" },
                { status: 400 }
            )
        }

        // Perform HEAD request to check accessibility
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 8000) // 8s timeout

        try {
            const response = await fetch(url, {
                method: 'HEAD',
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            })
            clearTimeout(timeoutId)

            const accessible = response.ok // 200-299

            return NextResponse.json({
                accessible,
                status: response.status,
                reason: accessible ? undefined : `HTTP ${response.status}`,
            })
        } catch (fetchError) {
            clearTimeout(timeoutId)

            // Network error or timeout
            const reason = fetchError instanceof Error && fetchError.name === 'AbortError'
                ? '请求超时'
                : '网络错误'

            return NextResponse.json({
                accessible: false,
                status: 0,
                reason,
            })
        }

    } catch (error) {
        console.error('[Check URL] Error:', error)
        return NextResponse.json(
            { accessible: false, reason: "检测失败" },
            { status: 500 }
        )
    }
}
