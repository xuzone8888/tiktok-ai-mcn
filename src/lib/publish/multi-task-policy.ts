export const MULTI_TASK_PRIVACY_LEVELS = [
    'PUBLIC_TO_EVERYONE',
    'MUTUAL_FOLLOW_FRIENDS',
    'FOLLOWER_OF_CREATOR',
    'SELF_ONLY',
] as const

export type MultiTaskPrivacyLevel = typeof MULTI_TASK_PRIVACY_LEVELS[number]

export const MULTI_TASK_DEFAULT_PUBLISH_OPTIONS = {
    allowComment: true,
    allowDuet: false,
    allowStitch: true,
    brandContentToggle: false,
    brandOrganicToggle: false,
    isAiGenerated: true,
    coverTimestampMs: 0,
}

const DEFAULT_VIDEO_HOSTS = [
    'media.toryxai.com',
    'media.tokfactoryai.com',
    'tokfactory-videos.oss-cn-beijing.aliyuncs.com',
    'tokfactory-videos.oss-accelerate.aliyuncs.com',
]

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov']

function normalizeHost(value: string | undefined | null) {
    if (!value) return ''

    try {
        return new URL(value.startsWith('http') ? value : `https://${value}`).hostname.toLowerCase()
    } catch {
        return value
            .replace(/^https?:\/\//, '')
            .replace(/\/+$/, '')
            .trim()
            .toLowerCase()
    }
}

export function parseMultiTaskPrivacyLevel(value: unknown): MultiTaskPrivacyLevel | null {
    return MULTI_TASK_PRIVACY_LEVELS.includes(value as MultiTaskPrivacyLevel)
        ? value as MultiTaskPrivacyLevel
        : null
}

export function getAllowedMultiTaskVideoHosts() {
    const customDomain = normalizeHost(process.env.ALIYUN_OSS_CUSTOM_DOMAIN)
    const bucket = process.env.ALIYUN_OSS_BUCKET || 'tokfactory-videos'
    const endpointHost = normalizeHost(process.env.ALIYUN_OSS_ENDPOINT || 'https://oss-cn-beijing.aliyuncs.com')
    const region = (process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing').replace(/^oss-/, '')
    const envHosts = (process.env.MULTI_TASK_VIDEO_ALLOWED_HOSTS || '')
        .split(',')
        .map(normalizeHost)
        .filter(Boolean)

    return Array.from(new Set([
        ...DEFAULT_VIDEO_HOSTS,
        customDomain,
        endpointHost ? `${bucket}.${endpointHost}` : '',
        `${bucket}.oss-${region}.aliyuncs.com`,
        `${bucket}.oss-accelerate.aliyuncs.com`,
        ...envHosts,
    ].filter(Boolean)))
}

export function assertAllowedMultiTaskVideoUrl(url: string, label = '视频') {
    let parsed: URL

    try {
        parsed = new URL(url)
    } catch {
        throw new Error(`${label} 地址格式无效`)
    }

    if (parsed.protocol !== 'https:') {
        throw new Error(`${label} 必须是 HTTPS 地址`)
    }

    const hostname = parsed.hostname.toLowerCase()
    const allowedHosts = getAllowedMultiTaskVideoHosts()
    if (!allowedHosts.includes(hostname)) {
        throw new Error(`${label} 不在允许的存储域名内`)
    }

    const path = decodeURIComponent(parsed.pathname).toLowerCase()
    if (!VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext))) {
        throw new Error(`${label} 格式不支持`)
    }
}
