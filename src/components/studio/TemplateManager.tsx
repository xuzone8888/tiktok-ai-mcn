"use client"

import { useEffect, useState } from "react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Loader2,
    Trash2,
    LayoutTemplate,
    Calendar,
    CheckCircle2,
    Video,
    ImageIcon,
    ArrowRight
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

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        if (!confirm("确定要删除这个方案吗？此操作无法撤销。")) return

        setDeletingId(id)
        try {
            const res = await fetch(`/api/templates/${id}`, {
                method: 'DELETE'
            })
            if (!res.ok) throw new Error("Failed to delete")

            setTemplates(prev => prev.filter(t => t.id !== id))
            toast({
                title: "已删除",
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
        onOpenChange(false)
        toast({
            title: "方案已加载",
            description: `已应用 "${template.name}" 的所有配置`
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[800px] h-[80vh] flex flex-col glass-card border-white/10 text-white p-0 gap-0 overflow-hidden">
                <div className="p-6 border-b border-white/10 flex justify-between items-center bg-black/20">
                    <div>
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <LayoutTemplate className="h-5 w-5 text-cyan-400" />
                            灵感方案库
                        </DialogTitle>
                        <p className="text-sm text-gray-400 mt-1">
                            选择一个已保存的方案快速开始创作
                        </p>
                    </div>
                    <div className="flex bg-black/30 p-1 rounded-lg">
                        <span className={cn(
                            "px-3 py-1 text-xs rounded-md flex items-center gap-1.5 transition-colors",
                            type === 'video_batch' ? "bg-cyan-500/20 text-cyan-400" : "text-gray-500"
                        )}>
                            <Video className="h-3.5 w-3.5" /> 视频方案
                        </span>
                        <span className={cn(
                            "px-3 py-1 text-xs rounded-md flex items-center gap-1.5 transition-colors",
                            type === 'image_batch' ? "bg-pink-500/20 text-pink-400" : "text-gray-500"
                        )}>
                            <ImageIcon className="h-3.5 w-3.5" /> 图片方案
                        </span>
                    </div>
                </div>

                <ScrollArea className="flex-1 p-6 bg-black/10">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-40 gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
                            <p className="text-sm text-gray-500">加载方案中...</p>
                        </div>
                    ) : templates.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-60 gap-4 text-center">
                            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                                <LayoutTemplate className="h-8 w-8 text-gray-600" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-medium text-gray-300">暂无保存的方案</h3>
                                <p className="text-sm text-gray-500 max-w-xs mx-auto">
                                    在创建任务时，点击 "保存方案" 即可将您的灵感和配置永久保存于此。
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {templates.map((template) => (
                                <div
                                    key={template.id}
                                    onClick={() => handleSelect(template)}
                                    className="group relative flex flex-col justify-between p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-cyan-500/30 hover:shadow-[0_0_15px_rgba(6,182,212,0.15)] transition-all cursor-pointer overflow-hidden"
                                >
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-start">
                                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-800 to-black border border-white/10 flex items-center justify-center group-hover:from-cyan-950 group-hover:to-black transition-colors">
                                                {template.type === 'video_batch' ? (
                                                    <Video className="h-5 w-5 text-gray-400 group-hover:text-cyan-400" />
                                                ) : (
                                                    <ImageIcon className="h-5 w-5 text-gray-400 group-hover:text-pink-400" />
                                                )}
                                            </div>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={(e) => handleDelete(e, template.id)}
                                                disabled={deletingId === template.id}
                                            >
                                                {deletingId === template.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </div>

                                        <div>
                                            <h4 className="font-medium text-white group-hover:text-cyan-400 transition-colors truncate">
                                                {template.name}
                                            </h4>
                                            <p className="text-xs text-gray-500 mt-1 line-clamp-2 min-h-[2.5em]">
                                                {template.description || "无描述"}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between text-xs text-gray-500">
                                        <span className="flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            {format(new Date(template.created_at), "MM月dd日", { locale: zhCN })}
                                        </span>
                                        <span className="flex items-center gap-1 text-cyan-500/0 group-hover:text-cyan-400 transition-colors transform translate-x-2 group-hover:translate-x-0">
                                            应用 <ArrowRight className="h-3 w-3" />
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </DialogContent>
        </Dialog>
    )
}
