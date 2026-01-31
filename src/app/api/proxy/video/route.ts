/**
 * Video Proxy API
 * 
 * Proxies OSS videos with correct headers for browser playback.
 * Fixes Content-Disposition: attachment issue that prevents video from playing.
 * 
 * GET /api/proxy/video?url=<oss-video-url>
 */

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60 // 1 minute timeout for video streaming

// Only allow OSS URLs from our domain
const ALLOWED_DOMAINS = [
    'media.toryxai.com',
    'tokfactory-videos.oss-cn-beijing.aliyuncs.com',
]

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get('url')

    if (!url) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
    }

    // Security: Only proxy from allowed domains
    try {
        const urlObj = new URL(url)
        if (!ALLOWED_DOMAINS.some(domain => urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain))) {
            return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 })
        }
    } catch {
        return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    try {
        // Fetch from OSS
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        })

        if (!response.ok) {
            return NextResponse.json(
                { error: `Upstream error: ${response.status}` },
                { status: response.status }
            )
        }

        // Get content type
        const contentType = response.headers.get('content-type') || 'video/mp4'
        const contentLength = response.headers.get('content-length')

        // Create response with correct headers for browser playback
        const headers = new Headers()
        headers.set('Content-Type', contentType)
        headers.set('Content-Disposition', 'inline')  // Allow browser to play video
        headers.set('Access-Control-Allow-Origin', '*')  // CORS
        headers.set('Cache-Control', 'public, max-age=86400')  // Cache for 1 day

        if (contentLength) {
            headers.set('Content-Length', contentLength)
        }

        // Stream the response
        return new NextResponse(response.body, {
            status: 200,
            headers,
        })

    } catch (error) {
        console.error('[Video Proxy] Error:', error)
        return NextResponse.json(
            { error: 'Failed to fetch video' },
            { status: 500 }
        )
    }
}
