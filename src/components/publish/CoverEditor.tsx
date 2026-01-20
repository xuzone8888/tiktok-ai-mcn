'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { ImageIcon, Upload, Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SelectedVideo } from '@/types/publish'
import { cn } from '@/lib/utils'

interface CoverEditorProps {
    video: SelectedVideo
    onCoverChange: (videoId: string, coverDataUrl: string, timestampMs?: number) => void
    onCoverOptionsGenerated?: (videoId: string, options: string[]) => void
    expanded?: boolean
}

export function CoverEditor({
    video,
    onCoverChange,
    onCoverOptionsGenerated,
    expanded = false
}: CoverEditorProps) {
    const [generating, setGenerating] = useState(false)
    const [coverOptions, setCoverOptions] = useState<string[]>(video.coverOptions || [])
    const fileInputRef = useRef<HTMLInputElement>(null)

    // 生成封面选项
    const generateCoverOptions = async () => {
        const videoUrl = video.localUrl || video.url
        if (!videoUrl) return

        setGenerating(true)
        try {
            const covers = await new Promise<string[]>((resolve) => {
                const videoEl = document.createElement('video')
                videoEl.crossOrigin = 'anonymous'
                videoEl.src = videoUrl
                videoEl.muted = true
                videoEl.playsInline = true

                const options: string[] = []
                const timePoints = [0.1, 0.25, 0.5, 0.75]
                let currentIndex = 0

                videoEl.onloadedmetadata = () => {
                    const captureFrame = () => {
                        if (currentIndex >= timePoints.length) {
                            resolve(options)
                            return
                        }
                        videoEl.currentTime = videoEl.duration * timePoints[currentIndex]
                    }

                    videoEl.onseeked = () => {
                        const canvas = document.createElement('canvas')
                        canvas.width = videoEl.videoWidth
                        canvas.height = videoEl.videoHeight
                        const ctx = canvas.getContext('2d')
                        if (ctx) {
                            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
                            options.push(canvas.toDataURL('image/jpeg', 0.7))
                        }
                        currentIndex++
                        captureFrame()
                    }

                    captureFrame()
                }

                videoEl.onerror = () => resolve([])
            })

            setCoverOptions(covers)
            onCoverOptionsGenerated?.(video.id, covers)
        } finally {
            setGenerating(false)
        }
    }

    // 处理封面上传
    const handleCoverUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        if (!file.type.startsWith('image/')) {
            return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
            const dataUrl = e.target?.result as string
            onCoverChange(video.id, dataUrl)
        }
        reader.readAsDataURL(file)

        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    if (!expanded) {
        // 紧凑模式：只显示当前封面
        return (
            <div className="relative w-16 h-10 rounded overflow-hidden bg-gray-800">
                {video.cover || video.thumbnail ? (
                    <Image
                        src={video.cover || video.thumbnail}
                        alt=""
                        fill
                        className="object-cover"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-gray-500" />
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">封面选择</span>
                <div className="flex items-center gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleCoverUpload}
                        className="hidden"
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs"
                    >
                        <Upload className="w-3 h-3 mr-1" />
                        上传封面
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={generateCoverOptions}
                        disabled={generating}
                        className="text-xs"
                    >
                        {generating ? (
                            <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : (
                            <ImageIcon className="w-3 h-3 mr-1" />
                        )}
                        生成选项
                    </Button>
                </div>
            </div>

            {/* 封面选项网格 */}
            {coverOptions.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                    {coverOptions.map((cover, index) => (
                        <div
                            key={index}
                            onClick={() => onCoverChange(video.id, cover, (index + 1) * 25 * video.duration! * 10)}
                            className={cn(
                                'relative aspect-video rounded overflow-hidden cursor-pointer ring-2 transition-all',
                                video.cover === cover ? 'ring-cyan-500' : 'ring-transparent hover:ring-white/30'
                            )}
                        >
                            <Image
                                src={cover}
                                alt={`封面 ${index + 1}`}
                                fill
                                className="object-cover"
                            />
                            {video.cover === cover && (
                                <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center">
                                    <Check className="w-3 h-3 text-white" />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* 当前封面预览 */}
            {!coverOptions.length && video.cover && (
                <div className="relative aspect-video w-32 rounded overflow-hidden">
                    <Image
                        src={video.cover}
                        alt="当前封面"
                        fill
                        className="object-cover"
                    />
                </div>
            )}
        </div>
    )
}
