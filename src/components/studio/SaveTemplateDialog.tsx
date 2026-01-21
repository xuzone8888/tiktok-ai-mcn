"use client"

import { useState, useEffect } from "react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, Film, Clock, Monitor, Smartphone, Square, UserCircle, ImageIcon, FileText, Wand2 } from "lucide-react"

// 配置预览项
interface ConfigPreviewItem {
    icon: React.ReactNode
    label: string
    value: string
}

// 图片预览项
interface ImagePreviewItem {
    url: string
    name: string
}

interface SaveTemplateDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSave: (name: string, description: string) => Promise<void>
    defaultName?: string
    // 新增：配置预览
    configPreview?: ConfigPreviewItem[]
    // 新增：图片预览
    imagePreview?: ImagePreviewItem[]
    // 新增：是否正在上传图片
    isUploading?: boolean
}

export function SaveTemplateDialog({
    open,
    onOpenChange,
    onSave,
    defaultName = "",
    configPreview = [],
    imagePreview = [],
    isUploading = false,
}: SaveTemplateDialogProps) {
    const [name, setName] = useState(defaultName)
    const [description, setDescription] = useState("")
    const [isLoading, setIsLoading] = useState(false)

    // 当 defaultName 变化时更新
    useEffect(() => {
        if (defaultName) {
            setName(defaultName)
        }
    }, [defaultName])

    const handleSave = async () => {
        if (!name.trim()) return

        setIsLoading(true)
        try {
            await onSave(name, description)
            setName("")
            setDescription("")
        } catch (error) {
            console.error("Failed to save template:", error)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] glass-card border-white/10 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-tiktok-cyan" />
                        保存为方案
                    </DialogTitle>
                    <DialogDescription className="text-gray-400">
                        保存当前创建任务的完整配置，下次可直接加载使用。
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {/* 方案名称 */}
                    <div className="grid gap-2">
                        <Label htmlFor="name" className="text-gray-300">
                            方案名称 *
                        </Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="例如：时尚穿搭视频方案"
                            className="bg-white/5 border-white/10 text-white placeholder:text-gray-500"
                        />
                    </div>

                    {/* 描述备注 */}
                    <div className="grid gap-2">
                        <Label htmlFor="description" className="text-gray-300">
                            描述备注 (选填)
                        </Label>
                        <Textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="记录这个方案的用途..."
                            className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 resize-none"
                            rows={2}
                        />
                    </div>

                    {/* 配置预览 */}
                    {configPreview.length > 0 && (
                        <div className="space-y-2">
                            <Label className="text-gray-300 flex items-center gap-2">
                                <span>📋</span>
                                将保存以下配置
                            </Label>
                            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                <div className="grid grid-cols-2 gap-2">
                                    {configPreview.map((item, index) => (
                                        <div key={index} className="flex items-center gap-2 text-sm">
                                            <span className="text-gray-500">{item.icon}</span>
                                            <span className="text-gray-400">{item.label}:</span>
                                            <span className="text-white font-medium truncate">{item.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 图片预览 */}
                    {imagePreview.length > 0 && (
                        <div className="space-y-2">
                            <Label className="text-gray-300 flex items-center gap-2">
                                <ImageIcon className="h-4 w-4" />
                                素材图片 ({imagePreview.length} 张)
                            </Label>
                            <ScrollArea className="w-full">
                                <div className="flex gap-2 pb-2">
                                    {imagePreview.map((img, index) => (
                                        <div
                                            key={index}
                                            className="relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-white/10"
                                        >
                                            <img
                                                src={img.url}
                                                alt={img.name}
                                                className="w-full h-full object-cover"
                                            />
                                            {index === 0 && (
                                                <Badge className="absolute bottom-0 left-0 right-0 rounded-none text-[8px] justify-center bg-tiktok-cyan text-black">
                                                    主图
                                                </Badge>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                            {isUploading && (
                                <p className="text-xs text-amber-400 flex items-center gap-1">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    正在上传图片到云存储...
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="text-gray-400 hover:text-white hover:bg-white/10"
                    >
                        取消
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={!name.trim() || isLoading || isUploading}
                        className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90 text-black border-none font-semibold"
                    >
                        {(isLoading || isUploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isUploading ? "上传中..." : "保存方案"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// 辅助函数：生成配置预览项
export function generateVideoConfigPreview(config: {
    modelType: string
    duration: number
    quality: string
    aspectRatio: string
    useAiModel: boolean
    aiModelName?: string | null
    createMode: string
    promptTemplate?: string
    batchCreateCount: number
}): ConfigPreviewItem[] {
    const items: ConfigPreviewItem[] = []

    // 模型
    const modelLabels: Record<string, string> = {
        "sora2": "Sora 2.0",
        "sora2-pro": "Sora 2.0 Pro",
        "veo3": "VEO3 快速版",
        "veo3-quality": "VEO3 高清版",
    }
    items.push({
        icon: <Film className="h-3.5 w-3.5" />,
        label: "模型",
        value: modelLabels[config.modelType] || config.modelType,
    })

    // 时长
    items.push({
        icon: <Clock className="h-3.5 w-3.5" />,
        label: "时长",
        value: `${config.duration}秒`,
    })

    // 画质
    items.push({
        icon: <Wand2 className="h-3.5 w-3.5" />,
        label: "画质",
        value: config.quality === "hd" ? "高清" : "标清",
    })

    // 比例
    const aspectIcons: Record<string, React.ReactNode> = {
        "16:9": <Monitor className="h-3.5 w-3.5" />,
        "9:16": <Smartphone className="h-3.5 w-3.5" />,
        "1:1": <Square className="h-3.5 w-3.5" />,
    }
    items.push({
        icon: aspectIcons[config.aspectRatio] || <Square className="h-3.5 w-3.5" />,
        label: "比例",
        value: config.aspectRatio,
    })

    // AI 模特
    items.push({
        icon: <UserCircle className="h-3.5 w-3.5" />,
        label: "AI模特",
        value: config.useAiModel && config.aiModelName ? config.aiModelName : "未使用",
    })

    // 创建数量
    items.push({
        icon: <ImageIcon className="h-3.5 w-3.5" />,
        label: "数量",
        value: `${config.batchCreateCount}个`,
    })

    return items
}

export function generateImageConfigPreview(config: {
    model: string
    action: string
    aspectRatio: string
    resolution: string
    batchCreateCount?: number
}): ConfigPreviewItem[] {
    const items: ConfigPreviewItem[] = []

    // 模型
    items.push({
        icon: <Film className="h-3.5 w-3.5" />,
        label: "模型",
        value: config.model === "nano-banana-pro" ? "专业版" : "快速版",
    })

    // 处理类型
    const actionLabels: Record<string, string> = {
        "upscale": "高清放大",
        "generate": "AI生成",
        "nine_grid": "九宫格",
    }
    items.push({
        icon: <Wand2 className="h-3.5 w-3.5" />,
        label: "处理",
        value: actionLabels[config.action] || config.action,
    })

    // 比例
    items.push({
        icon: <Square className="h-3.5 w-3.5" />,
        label: "比例",
        value: config.aspectRatio || "自动",
    })

    // 分辨率
    items.push({
        icon: <Monitor className="h-3.5 w-3.5" />,
        label: "分辨率",
        value: config.resolution?.toUpperCase() || "1K",
    })

    return items
}
