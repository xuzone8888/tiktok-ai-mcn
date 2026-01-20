'use client'

import { useState } from 'react'
import { Sparkles, Loader2, Check, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { GeneratedTitle } from '@/types/publish'
import { useToast } from '@/hooks/use-toast'

interface TitleGeneratorProps {
    open: boolean
    onClose: () => void
    videoCount: number
    onApplyTitles: (titles: string[]) => void
}

export function TitleGenerator({
    open,
    onClose,
    videoCount,
    onApplyTitles
}: TitleGeneratorProps) {
    const { toast } = useToast()
    const [description, setDescription] = useState('')
    const [language, setLanguage] = useState<'zh' | 'en'>('en')
    const [titles, setTitles] = useState<GeneratedTitle[]>([])
    const [generating, setGenerating] = useState(false)
    const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null)

    // 生成所有标题
    const generateAllTitles = async () => {
        if (!description.trim()) {
            toast({ variant: 'destructive', title: '请输入视频描述' })
            return
        }

        setGenerating(true)
        try {
            const response = await fetch('/api/publish/generate-titles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description,
                    count: videoCount,
                    language
                })
            })

            const data = await response.json()
            if (data.success && data.titles) {
                setTitles(data.titles.map((content: string, index: number) => ({
                    index,
                    content,
                    selected: true
                })))
            } else {
                toast({ variant: 'destructive', title: '生成失败', description: data.error })
            }
        } catch (error) {
            console.error('Generate titles error:', error)
            toast({ variant: 'destructive', title: '生成失败' })
        } finally {
            setGenerating(false)
        }
    }

    // 重新生成单个标题
    const regenerateSingleTitle = async (index: number) => {
        setRegeneratingIndex(index)
        try {
            const response = await fetch('/api/publish/generate-titles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description,
                    count: 1,
                    language
                })
            })

            const data = await response.json()
            if (data.success && data.titles?.[0]) {
                setTitles(prev => prev.map((t, i) =>
                    i === index ? { ...t, content: data.titles[0] } : t
                ))
            }
        } catch (error) {
            console.error('Regenerate title error:', error)
        } finally {
            setRegeneratingIndex(null)
        }
    }

    // 切换选中状态
    const toggleSelection = (index: number) => {
        setTitles(prev => prev.map((t, i) =>
            i === index ? { ...t, selected: !t.selected } : t
        ))
    }

    // 编辑标题
    const updateTitle = (index: number, content: string) => {
        setTitles(prev => prev.map((t, i) =>
            i === index ? { ...t, content } : t
        ))
    }

    // 应用选中的标题
    const applySelectedTitles = () => {
        const selectedTitles = titles
            .filter(t => t.selected)
            .map(t => t.content)

        if (selectedTitles.length === 0) {
            toast({ variant: 'destructive', title: '请至少选择一个标题' })
            return
        }

        onApplyTitles(selectedTitles)
        onClose()
        setTitles([])
    }

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-2xl bg-gray-900 border-gray-700">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-white">
                        <Sparkles className="w-5 h-5 text-cyan-400" />
                        AI 标题助手
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* 描述输入 */}
                    <div className="space-y-2">
                        <label className="text-sm text-gray-400">视频主题描述</label>
                        <Textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="描述视频内容，AI 将为每个视频生成独特的标题..."
                            className="bg-gray-800 border-gray-700 text-white"
                            rows={3}
                        />
                    </div>

                    {/* 语言选择 */}
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-400">语言：</span>
                        <div className="flex gap-2">
                            {[
                                { value: 'en', label: 'English' },
                                { value: 'zh', label: '中文' }
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => setLanguage(opt.value as 'zh' | 'en')}
                                    className={`px-3 py-1 rounded-lg text-sm transition-colors ${language === opt.value
                                            ? 'bg-cyan-500 text-white'
                                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 生成按钮 */}
                    <Button
                        onClick={generateAllTitles}
                        disabled={generating || !description.trim()}
                        className="w-full bg-gradient-to-r from-cyan-500 to-pink-500"
                    >
                        {generating ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                生成中...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4 mr-2" />
                                为 {videoCount} 个视频生成标题
                            </>
                        )}
                    </Button>

                    {/* 生成的标题列表 */}
                    {titles.length > 0 && (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {titles.map((title, index) => (
                                <div
                                    key={index}
                                    className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${title.selected
                                            ? 'bg-cyan-500/10 border-cyan-500/30'
                                            : 'bg-gray-800 border-gray-700'
                                        }`}
                                >
                                    <button
                                        onClick={() => toggleSelection(index)}
                                        className={`mt-1 w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border ${title.selected
                                                ? 'bg-cyan-500 border-cyan-500'
                                                : 'border-gray-600'
                                            }`}
                                    >
                                        {title.selected && <Check className="w-3 h-3 text-white" />}
                                    </button>

                                    <div className="flex-1">
                                        <input
                                            value={title.content}
                                            onChange={(e) => updateTitle(index, e.target.value)}
                                            className="w-full bg-transparent text-white text-sm outline-none"
                                        />
                                    </div>

                                    <button
                                        onClick={() => regenerateSingleTitle(index)}
                                        disabled={regeneratingIndex === index}
                                        className="text-gray-400 hover:text-white"
                                    >
                                        {regeneratingIndex === index ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <RefreshCw className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 底部操作 */}
                {titles.length > 0 && (
                    <div className="flex justify-end gap-2 mt-4">
                        <Button variant="ghost" onClick={onClose}>
                            取消
                        </Button>
                        <Button
                            onClick={applySelectedTitles}
                            className="bg-gradient-to-r from-cyan-500 to-pink-500"
                        >
                            应用 {titles.filter(t => t.selected).length} 个标题
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
