"use client"

import { useEffect, useState } from "react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Loader2,
    Trash2,
    LayoutTemplate,
    Calendar,
    Video,
    ImageIcon,
    ArrowRight,
    Film,
    Clock,
    Monitor,
    Smartphone,
    Square,
    UserCircle,
    Wand2,
} from "lucide-react"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export interface Template {
    id: string
    name: string
    description?: string
    type: 'video_batch' | 'image_batch'
    config: any
    created_at: string
}

interface TemplateManagerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    type: 'video_batch' | 'image_batch'
    onSelect: (template: Template) => void
}

// 辅助函数：获取视频配置摘要
function getVideoConfigSummary(config: any): string {
    const parts: string[] = []

    // 模型
    const modelLabels: Record<string, string> = {
        "sora2": "Sora2",
        "sora2-pro": "Sora2 Pro",
        "veo3-fast": "Veo3\uff08\u5feb\u901f\uff09",
        "veo3-std": "Veo3\uff08\u6807\u51c6\uff09",
        "veo3-4k": "Veo3\uff084K\uff09",
    }
    const gs = config.globalSettings || config
    if (gs.modelType) {
        parts.push(modelLabels[gs.modelType] || gs.modelType)
    }

    // 时长
    if (gs.duration) {
        parts.push(`${gs.duration}秒`)
    }

    // 画质
    if (gs.quality === "hd") {
        parts.push("高清")
    }

    // 比例
    if (gs.aspectRatio) {
        parts.push(gs.aspectRatio)
    }

    return parts.join(" · ")
}

// 辅助函数：获取图片配置摘要
function getImageConfigSummary(config: any): string {
    const parts: string[] = []

    const gs = config.globalSettings || config

    // 模型
    if (gs.model === "nano-banana-pro") {
        parts.push("专业版")
    } else {
        parts.push("快速版")
    }

    // 处理类型
    const actionLabels: Record<string, string> = {
        "upscale": "高清放大",
        "generate": "AI生成",
        "nine_grid": "九宫格",
    }
    if (gs.action) {
        parts.push(actionLabels[gs.action] || gs.action)
    }

    // 比例
    if (gs.aspectRatio && gs.aspectRatio !== "auto") {
        parts.push(gs.aspectRatio)
    }

    return parts.join(" · ")
}

// 辅助函数: 获取图片数量
function getImageCount(config: any): number {
    return config.templateImages?.length || 0
}

export function TemplateManager({
    open,
    onOpenChange,
    type,
    onSelect,
}: TemplateManagerProps) {
    const { toast } = useToast()
    const [templates, setTemplates] = useState<Template[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null) // 删除确认弹窗

    const fetchTemplates = async () => {
        setIsLoading(true)
        try {
            const res = await fetch(`/api/templates?type=${type}`)
            if (!res.ok) throw new Error("Failed to fetch templates")
            const data = await res.json()
            setTemplates(data.data || [])
        } catch (error) {
            console.error(error)
            toast({
                variant: "destructive",
                title: "获取方案失败",
                description: "无法加载已保存的方案列表"
            })
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        if (open) {
            fetchTemplates()
        }
    }, [open, type])

    const handleDeleteClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        setDeleteConfirmId(id) // 打开确认弹窗
    }

    const confirmDelete = async () => {
        if (!deleteConfirmId) return
        const id = deleteConfirmId
        setDeleteConfirmId(null) // 关闭弹窗

        setDeletingId(id)
        try {
            const res = await fetch(`/api/templates/${id}`, {
                method: 'DELETE'
            })
            if (!res.ok) throw new Error("Failed to delete")

            setTemplates(prev => prev.filter(t => t.id !== id))
            toast({
                title: "✅ 已删除",
                description: "方案已成功移除"
            })
        } catch (error) {
            toast({
                variant: "destructive",
                title: "删除失败",
                description: "无法删除该方案"
            })
        } finally {
            setDeletingId(null)
        }
    }

    const handleSelect = (template: Template) => {
        onSelect(template)
        // 不要在这里关闭，让 onSelect 处理
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[700px] h-[70vh] flex flex-col glass-card border-white/10 text-white p-0 gap-0 overflow-hidden">
                    <div className="p-5 border-b border-white/10 flex justify-between items-center bg-black/20">
                        <div>
                            <DialogTitle className="flex items-center gap-2 text-lg">
                                <LayoutTemplate className="h-5 w-5 text-tiktok-cyan" />
                                我的方案库
                            </DialogTitle>
                            <p className="text-sm text-gray-400 mt-1">
                                选择方案后自动填充所有配置，可直接创建任务
                            </p>
                        </div>
                        <Badge variant="outline" className={cn(
                            "px-3 py-1 text-xs mr-8",
                            type === 'video_batch'
                                ? "border-tiktok-cyan/50 text-tiktok-cyan"
                                : "border-tiktok-pink/50 text-tiktok-pink"
                        )}>
                            {type === 'video_batch' ? (
                                <><Video className="h-3.5 w-3.5 mr-1" /> 视频方案</>
                            ) : (
                                <><ImageIcon className="h-3.5 w-3.5 mr-1" /> 图片方案</>
                            )}
                        </Badge>
                    </div>

                    <ScrollArea className="flex-1 p-5 bg-black/10">
                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center h-40 gap-3">
                                <Loader2 className="h-8 w-8 animate-spin text-tiktok-cyan" />
                                <p className="text-sm text-gray-500">加载方案中...</p>
                            </div>
                        ) : templates.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 gap-4 text-center">
                                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                                    <LayoutTemplate className="h-8 w-8 text-gray-600" />
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-lg font-medium text-gray-300">暂无保存的方案</h3>
                                    <p className="text-sm text-gray-500 max-w-xs mx-auto">
                                        在创建任务弹窗中点击&quot;保存为方案&quot;即可将配置保存于此
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {templates.map((template) => {
                                    const configSummary = type === 'video_batch'
                                        ? getVideoConfigSummary(template.config)
                                        : getImageConfigSummary(template.config)
                                    const imageCount = getImageCount(template.config)
                                    const hasAiModel = template.config.globalSettings?.useAiModel && template.config.globalSettings?.aiModelName
                                    const promptPreview = template.config.createPrompt || template.config.promptTemplate

                                    return (
                                        <div
                                            key={template.id}
                                            onClick={() => handleSelect(template)}
                                            className="group relative flex flex-col p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-tiktok-cyan/40 hover:shadow-[0_0_20px_rgba(6,182,212,0.15)] transition-all cursor-pointer"
                                        >
                                            {/* 头部：名称和删除 */}
                                            <div className="flex justify-between items-start mb-3">
                                                <div className="flex items-center gap-2">
                                                    <div className={cn(
                                                        "w-8 h-8 rounded-lg flex items-center justify-center",
                                                        type === 'video_batch'
                                                            ? "bg-tiktok-cyan/20"
                                                            : "bg-tiktok-pink/20"
                                                    )}>
                                                        {type === 'video_batch' ? (
                                                            <Video className="h-4 w-4 text-tiktok-cyan" />
                                                        ) : (
                                                            <ImageIcon className="h-4 w-4 text-tiktok-pink" />
                                                        )}
                                                    </div>
                                                    <h4 className="font-medium text-white group-hover:text-tiktok-cyan transition-colors truncate max-w-[180px]">
                                                        {template.name}
                                                    </h4>
                                                </div>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-7 w-7 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={(e) => handleDeleteClick(e, template.id)}
                                                    disabled={deletingId === template.id}
                                                >
                                                    {deletingId === template.id ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    )}
                                                </Button>
                                            </div>

                                            {/* 配置摘要 */}
                                            <div className="flex flex-wrap gap-1.5 mb-3">
                                                <Badge variant="secondary" className="text-[10px] bg-white/10 text-gray-300 hover:bg-white/10">
                                                    {configSummary}
                                                </Badge>
                                                {hasAiModel && (
                                                    <Badge variant="secondary" className="text-[10px] bg-purple-500/20 text-purple-400 hover:bg-purple-500/20">
                                                        <UserCircle className="h-2.5 w-2.5 mr-0.5" />
                                                        {template.config.globalSettings.aiModelName}
                                                    </Badge>
                                                )}
                                                {imageCount > 0 && (
                                                    <Badge variant="secondary" className="text-[10px] bg-amber-500/20 text-amber-400 hover:bg-amber-500/20">
                                                        <ImageIcon className="h-2.5 w-2.5 mr-0.5" />
                                                        {imageCount}张图
                                                    </Badge>
                                                )}
                                            </div>

                                            {/* 提示词预览 */}
                                            {promptPreview && (
                                                <p className="text-xs text-gray-500 line-clamp-2 mb-3">
                                                    {promptPreview}
                                                </p>
                                            )}

                                            {/* 图片缩略图 */}
                                            {template.config.templateImages && template.config.templateImages.length > 0 && (
                                                <div className="flex gap-1.5 mb-3">
                                                    {template.config.templateImages.slice(0, 4).map((img: any, idx: number) => (
                                                        <div
                                                            key={idx}
                                                            className="w-10 h-10 rounded-md overflow-hidden border border-white/10 flex-shrink-0"
                                                        >
                                                            <img
                                                                src={img.url}
                                                                alt={img.name}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        </div>
                                                    ))}
                                                    {template.config.templateImages.length > 4 && (
                                                        <div className="w-10 h-10 rounded-md bg-white/10 flex items-center justify-center text-xs text-gray-400">
                                                            +{template.config.templateImages.length - 4}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* 底部：时间和应用按钮 */}
                                            <div className="mt-auto pt-3 border-t border-white/5 flex items-center justify-between text-xs">
                                                <span className="flex items-center gap-1 text-gray-500">
                                                    <Calendar className="h-3 w-3" />
                                                    {format(new Date(template.created_at), "MM月dd日 HH:mm", { locale: zhCN })}
                                                </span>
                                                <span className="flex items-center gap-1 text-tiktok-cyan opacity-0 group-hover:opacity-100 transition-opacity">
                                                    应用方案 <ArrowRight className="h-3 w-3" />
                                                </span>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </ScrollArea>
                </DialogContent>
            </Dialog>

            {/* 删除确认弹窗 - 自定义 UI */}
            <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
                <AlertDialogContent className="bg-black/95 border-white/10 text-white backdrop-blur-xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-lg font-semibold flex items-center gap-2">
                            <Trash2 className="h-5 w-5 text-red-400" />
                            确认删除方案
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            确定要删除这个方案吗？此操作无法撤销，删除后将无法恢复。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-3">
                        <AlertDialogCancel className="bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:text-white">
                            取消
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            className="bg-red-500/80 hover:bg-red-500 text-white border-none"
                        >
                            确认删除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
