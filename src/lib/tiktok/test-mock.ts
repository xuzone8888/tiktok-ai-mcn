const DEFAULT_ALLOWED_SUPABASE_PROJECT = 'wjfgusdwudsynbsyveoe'

function parseList(value: string | undefined) {
    return (value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
}

function getSupabaseProjectId() {
    try {
        const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname
        return host.split('.')[0] || ''
    } catch {
        return ''
    }
}

export function isTikTokTestMockEnabled() {
    if (process.env.TIKTOK_TEST_MOCK_MODE !== 'true') {
        return false
    }

    const projectId = getSupabaseProjectId()
    const allowedProjects = parseList(process.env.TIKTOK_TEST_MOCK_ALLOWED_SUPABASE_PROJECTS)
    const allowList = allowedProjects.length ? allowedProjects : [DEFAULT_ALLOWED_SUPABASE_PROJECT]

    if (!projectId || !allowList.includes(projectId)) {
        console.warn('[TikTok Test Mock] Disabled because Supabase project is not allowlisted.', {
            projectId: projectId || 'unknown',
        })
        return false
    }

    return true
}

export function isTikTokMockCredential(value: string | undefined | null) {
    return !!value && (
        value.startsWith('mock-')
        || value.startsWith('seed-')
    )
}
