import type { TikTokVideoMimeType } from './content-posting'
import { isTrustedTikTokUploadUrl } from './file-upload-contract'

const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000
const MAX_CHUNK_ATTEMPTS = 3
const MIN_CHUNK_BYTES = 5 * 1024 * 1024
const MAX_CHUNK_BYTES = 64 * 1024 * 1024
const MAX_FINAL_CHUNK_BYTES = 128 * 1024 * 1024

export class TikTokFileTransferError extends Error {
    readonly code: 'invalid_upload_plan' | 'upload_rejected' | 'upload_outcome_unknown'
    readonly httpStatus: number | null

    constructor(
        code: TikTokFileTransferError['code'],
        message: string,
        httpStatus: number | null = null
    ) {
        super(message)
        this.name = 'TikTokFileTransferError'
        this.code = code
        this.httpStatus = httpStatus
    }
}

function validateUploadUrl(uploadUrl: string): void {
    if (!isTrustedTikTokUploadUrl(uploadUrl)) {
        throw new TikTokFileTransferError(
            'invalid_upload_plan',
            'TikTok 上传地址无效，请重新创建发布任务'
        )
    }
}

function chunkBounds(
    fileSize: number,
    chunkSize: number,
    totalChunkCount: number,
    index: number
) {
    const start = index * chunkSize
    const isFinal = index === totalChunkCount - 1
    const endExclusive = isFinal ? fileSize : start + chunkSize
    return { start, endExclusive, isFinal }
}

export async function uploadFileDirectlyToTikTok(options: {
    uploadUrl: string
    file: File
    mimeType: TikTokVideoMimeType
    chunkSize: number
    totalChunkCount: number
    onProgress?: (progress: number) => void
    fetchImpl?: typeof fetch
}): Promise<void> {
    const {
        uploadUrl,
        file,
        mimeType,
        chunkSize,
        totalChunkCount,
        onProgress,
        fetchImpl = fetch,
    } = options

    validateUploadUrl(uploadUrl)
    const finalChunkSize = file.size - ((totalChunkCount - 1) * chunkSize)
    const invalidSingleChunk = totalChunkCount === 1 && (
        chunkSize !== file.size
        || file.size > MAX_CHUNK_BYTES
    )
    const invalidMultiChunk = totalChunkCount > 1 && (
        chunkSize < MIN_CHUNK_BYTES
        || chunkSize > MAX_CHUNK_BYTES
        || Math.floor(file.size / chunkSize) !== totalChunkCount
        || finalChunkSize < chunkSize
        || finalChunkSize > MAX_FINAL_CHUNK_BYTES
    )
    if (
        !Number.isSafeInteger(file.size)
        || file.size <= 0
        || !Number.isSafeInteger(chunkSize)
        || chunkSize <= 0
        || !Number.isSafeInteger(totalChunkCount)
        || totalChunkCount < 1
        || totalChunkCount > 1000
        || invalidSingleChunk
        || invalidMultiChunk
    ) {
        throw new TikTokFileTransferError(
            'invalid_upload_plan',
            'TikTok 上传分片参数无效，请重新创建发布任务'
        )
    }

    for (let index = 0; index < totalChunkCount; index += 1) {
        const { start, endExclusive, isFinal } = chunkBounds(
            file.size,
            chunkSize,
            totalChunkCount,
            index
        )
        const chunk = file.slice(start, endExclusive, mimeType)
        const expectedStatus = isFinal ? 201 : 206
        let response: Response | null = null
        let hadAmbiguousAttempt = false

        for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS; attempt += 1) {
            try {
                response = await fetchImpl(uploadUrl, {
                    method: 'PUT',
                    credentials: 'omit',
                    redirect: 'error',
                    referrerPolicy: 'no-referrer',
                    headers: {
                        'Content-Type': mimeType,
                        'Content-Range': `bytes ${start}-${endExclusive - 1}/${file.size}`,
                    },
                    body: chunk,
                    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
                })
            } catch {
                response = null
            }

            if (response?.status === expectedStatus) break
            const retryable = response === null || response.status >= 500
            if (retryable) hadAmbiguousAttempt = true
            if (!retryable || attempt === MAX_CHUNK_ATTEMPTS) break
            await new Promise(resolve => setTimeout(resolve, 250 * attempt))
        }

        if (response?.status !== expectedStatus) {
            const status = response?.status ?? null
            const ambiguous = hadAmbiguousAttempt
                || status === null
                || (status !== null && status >= 200 && status < 300)
                || status === 408
                || status === 409
                || status === 416
                || status === 425
                || status === 429
                || (status !== null && status >= 500)
            throw new TikTokFileTransferError(
                ambiguous ? 'upload_outcome_unknown' : 'upload_rejected',
                ambiguous
                    ? '无法确认 TikTok 是否收到完整文件，请勿重复创建发布任务'
                    : 'TikTok 拒绝了文件上传，请检查文件格式后重试',
                status
            )
        }

        onProgress?.(Math.round((endExclusive / file.size) * 100))
    }
}
