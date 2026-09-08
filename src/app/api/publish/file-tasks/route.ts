import type { NextRequest } from 'next/server'

import { POST as createPublishTask } from '../tasks/route'

// FILE_UPLOAD creation deliberately uses a route that does not exist in the
// previous application revision. During a rolling deployment an old instance
// therefore returns 404 instead of silently treating a local file as a legacy
// PULL_FROM_URL placeholder and dispatching the wrong workflow.
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
    return createPublishTask(request)
}
