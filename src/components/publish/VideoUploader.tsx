'use client'

import { useState, useRef } from 'react'
import { Upload, Loader2, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    FileUploadStatus,
    SelectedVideo,
    TIKTOK_VIDEO_FORMATS,
    TIKTOK_MAX_FILE_SIZE
} from '@/types/publish'

interface VideoUploaderProps {
    onVideosAdded: (videos: SelectedVideo[]) => void
    disabled?: boolean
}

export function VideoUploader({ onVideosAdded, disabled }: VideoUploaderProps) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [uploadingFiles, setUploadingFiles] = useState<FileUploadStatus[]>([])
    const [uploadError, setUploadError] = useState<string | null>(null)

    // 生成视频缩略图
    const generateVideoThumbnail = (videoFile: File): Promise<string> => {
        return new Promise((resolve) => {
            const video = document.createElement('video')
            video.preload = 'metadata'
            video.muted = true
            video.playsInline = true

            video.onloadeddata = () => {
                video.currentTime = Math.min(1, video.duration / 2)
            }

            video.onseeked = () => {
                const canvas = document.createElement('canvas')
                canvas.width = video.videoWidth
                canvas.height = video.videoHeight
                const ctx = canvas.getContext('2d')
                if (ctx) {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
                    const thumbnail = canvas.toDataURL('image/jpeg', 0.7)
                    URL.revokeObjectURL(video.src)
                    resolve(thumbnail)
                } else {
                    URL.revokeObjectURL(video.src)
                    resolve('')
                }
            }

            video.onerror = () => {
                URL.revokeObjectURL(video.src)
                resolve('')
            }

            video.src = URL.createObjectURL(videoFile)
        })
    }

    // 处理文件上传
    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files
        if (!files || files.length === 0) return

        setUploadError(null)
        const fileList = Array.from(files)
        const validFiles: { file: File; id: string }[] = []

        // 验证文件
        for (const file of fileList) {
            const ext = '.' + file.name.split('.').pop()?.toLowerCase()
            if (!TIKTOK_VIDEO_FORMATS.includes(ext)) {
                setUploadError(`不支持的格式: ${ext}。支持: ${TIKTOK_VIDEO_FORMATS.join(', ')}`)
                continue
            }
            if (file.size > TIKTOK_MAX_FILE_SIZE) {
                setUploadError(`文件过大: ${(file.size / (1024 * 1024 * 1024)).toFixed(2)}GB。最大: 4GB`)
                continue
            }
            validFiles.push({
                file,
                id: `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            })
        }

        if (validFiles.length === 0) return

        // 初始化上传状态
        const initialStatus: FileUploadStatus[] = validFiles.map(({ file, id }) => ({
            id,
            name: file.name,
            progress: 0,
            status: 'pending' as const
        }))
        setUploadingFiles(initialStatus)

        // 状态更新辅助函数
        const updateFileStatus = (fileId: string, updates: Partial<FileUploadStatus>) => {
            setUploadingFiles(prev => prev.map(f =>
                f.id === fileId ? { ...f, ...updates } : f
            ))
        }

        // 上传单个文件
        const uploadSingleFile = async ({ file, id }: { file: File; id: string }) => {
            const MAX_RETRIES = 2
            let lastError: Error | null = null

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                updateFileStatus(id, { status: 'uploading', progress: 0, error: undefined })

                try {
                    const thumbnailPromise = attempt === 1 ? generateVideoThumbnail(file) : Promise.resolve('')

                    // 获取上传凭证
                    updateFileStatus(id, { progress: 5 })
                    const credentialsRes = await fetch('/api/upload/oss-credentials', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            filename: file.name,
                            contentType: file.type || 'video/mp4'
                        })
                    })

                    if (!credentialsRes.ok) {
                        const errData = await credentialsRes.json().catch(() => ({}))
                        throw new Error(errData.error || '获取上传凭证失败')
                    }

                    const { success, data: credentials } = await credentialsRes.json()
                    if (!success || !credentials?.uploadUrl) {
                        throw new Error('获取上传凭证失败')
                    }

                    // 直传 OSS
                    const ossUrl = await new Promise<string>((resolve, reject) => {
                        const xhr = new XMLHttpRequest()
                        let lastReportedProgress = 10

                        xhr.upload.onprogress = (event) => {
                            if (event.lengthComputable) {
                                const percent = Math.round(10 + (event.loaded / event.total) * 85)
                                if (percent >= lastReportedProgress + 5 || percent >= 95) {
                                    lastReportedProgress = percent
                                    updateFileStatus(id, { progress: percent })
                                }
                            }
                        }

                        xhr.onload = () => {
                            if (xhr.status >= 200 && xhr.status < 300) {
                                resolve(credentials.publicUrl)
                            } else {
                                reject(new Error(`OSS上传失败 (${xhr.status})`))
                            }
                        }

                        xhr.onerror = () => reject(new Error('网络错误'))
                        xhr.ontimeout = () => reject(new Error('上传超时'))

                        xhr.open('PUT', credentials.uploadUrl)
                        xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
                        xhr.timeout = 600000
                        xhr.send(file)
                    })

                    updateFileStatus(id, { progress: 98 })

                    const thumbnail = await thumbnailPromise
                    const localBlobUrl = URL.createObjectURL(file)

                    const newVideo: SelectedVideo = {
                        id,
                        type: 'upload',
                        name: file.name,
                        thumbnail: thumbnail || '',
                        url: ossUrl,
                        localUrl: localBlobUrl,
                        duration: 0
                    }

                    onVideosAdded([newVideo])
                    updateFileStatus(id, { status: 'done', progress: 100 })
                    return

                } catch (error) {
                    lastError = error instanceof Error ? error : new Error('上传失败')
                    console.error(`Upload error (attempt ${attempt}/${MAX_RETRIES}):`, error)

                    if (attempt < MAX_RETRIES) {
                        updateFileStatus(id, { progress: 0, error: `重试中 (${attempt}/${MAX_RETRIES})...` })
                        await new Promise(resolve => setTimeout(resolve, attempt * 1000))
                    }
                }
            }

            updateFileStatus(id, {
                status: 'error',
                progress: 0,
                error: lastError?.message || '上传失败'
            })
        }

        // 并发控制函数
        const asyncPool = async <T,>(poolLimit: number, array: T[], iteratorFn: (item: T) => Promise<void>) => {
            const ret = []
            const executing: Promise<void>[] = []
            for (const item of array) {
                const p = Promise.resolve().then(() => iteratorFn(item))
                ret.push(p)

                if (poolLimit <= array.length) {
                    const e = p.then(() => {
                        executing.splice(executing.indexOf(e as any), 1)
                    }) as any
                    executing.push(e)
                    if (executing.length >= poolLimit) {
                        await Promise.race(executing)
                    }
                }
            }
            return Promise.all(ret)
        }

        // 限制并发上传数为 2，避免带宽拥塞
        await asyncPool(2, validFiles, uploadSingleFile)

        // 清理状态
        setTimeout(() => {
            setUploadingFiles([])
        }, 2000)

        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    return (
        <div className="space-y-4">
            {/* 上传按钮 */}
            <input
                ref={fileInputRef}
                type="file"
                accept={TIKTOK_VIDEO_FORMATS.join(',')}
                multiple
                onChange={handleFileUpload}
                className="hidden"
                disabled={disabled}
            />

            <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || uploadingFiles.some(f => f.status === 'uploading')}
                className="w-full h-24 border-dashed border-2 hover:border-cyan-500/50 hover:bg-cyan-500/5"
            >
                <div className="flex flex-col items-center gap-2">
                    <Upload className="w-6 h-6 text-gray-400" />
                    <span className="text-sm text-gray-400">
                        点击或拖拽上传视频
                    </span>
                    <span className="text-xs text-gray-500">
                        支持 MP4、WebM、MOV，最大 4GB
                    </span>
                </div>
            </Button>

            {/* 上传进度列表 */}
            {uploadingFiles.length > 0 && (
                <div className="space-y-2">
                    {uploadingFiles.map(file => (
                        <div
                            key={file.id}
                            className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/10"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm truncate">{file.name}</span>
                                    {file.status === 'uploading' && (
                                        <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                                    )}
                                    {file.status === 'done' && (
                                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                                    )}
                                    {file.status === 'error' && (
                                        <AlertCircle className="w-4 h-4 text-red-400" />
                                    )}
                                </div>
                                {file.status === 'uploading' && (
                                    <div className="mt-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-cyan-500 to-pink-500 transition-all"
                                            style={{ width: `${file.progress}%` }}
                                        />
                                    </div>
                                )}
                                {file.error && (
                                    <span className="text-xs text-red-400">{file.error}</span>
                                )}
                            </div>
                            <span className="text-xs text-gray-500">
                                {file.progress}%
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* 错误提示 */}
            {uploadError && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span className="text-sm text-red-400">{uploadError}</span>
                    <button
                        onClick={() => setUploadError(null)}
                        className="ml-auto"
                    >
                        <X className="w-4 h-4 text-red-400" />
                    </button>
                </div>
            )}
        </div>
    )
}
