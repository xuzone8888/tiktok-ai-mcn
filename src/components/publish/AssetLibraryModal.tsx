'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { X, Loader2, Check, AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { AssetItem, SelectedVideo, BatchTransferState } from '@/types/publish'
import { format } from 'date-fns'

interface AssetLibraryModalProps {
    open: boolean
    onClose: () => void
    onVideosAdded: (videos: SelectedVideo[]) => void
    selectedVideoIds: string[]  // 已选择的视频 ID
}

const CONCURRENT_TRANSFER_LIMIT = 5

export function AssetLibraryModal({
    open,
    onClose,
    onVideosAdded,
    selectedVideoIds
}: AssetLibraryModalProps) {
    const { toast } = useToast()
    const [assets, setAssets] = useState<AssetItem[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
    const [transferringAssets, setTransferringAssets] = useState<Set<string>>(new Set())
    const [batchTransfer, setBatchTransfer] = useState<BatchTransferState>({
        isTransferring: false,
        total: 0,
        completed: 0,
        failed: 0,
        currentBatch: []
    })

    // 检查 URL 是否可访问
    const checkUrlAccessible = async (url: string): Promise<boolean> => {
        try {
            const response = await fetch('/api/upload/check-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            })
            const result = await response.json()
            return result.accessible === true
        } catch {
            return false
        }
    }

    // 删除过期任务
    const deleteExpiredTask = async (taskId: string) => {
        try {
            await fetch(`/api/user/tasks/${taskId}`, { method: 'DELETE' })
        } catch (error) {
            console.error('Failed to delete expired task:', error)
        }
    }

    // 获取资产列表
    const fetchAssets = useCallback(async () => {
        setLoading(true)
        try {
            const response = await fetch('/api/user/tasks?type=video&status=completed&limit=50')
            if (response.ok) {
                const result = await response.json()
                const tasks = result.data?.tasks || result.tasks || []
                const videoTasks = tasks.filter((t: AssetItem) => t.type === 'video' && t.resultUrl)

                // 并行检查 URL 可访问性
                const accessibilityChecks = await Promise.all(
                    videoTasks.map(async (task: AssetItem) => ({
                        task,
                        isAccessible: await checkUrlAccessible(task.resultUrl!)
                    }))
                )

                const validVideos: AssetItem[] = []
                const expiredVideos: AssetItem[] = []

                accessibilityChecks.forEach(({ task, isAccessible }) => {
                    if (isAccessible) {
                        validVideos.push(task)
                    } else {
                        expiredVideos.push(task)
                    }
                })

                // 清理过期视频
                if (expiredVideos.length > 0) {
                    toast({
                        title: '清理过期视频',
                        description: `正在删除 ${expiredVideos.length} 个已过期的视频...`,
                    })
                    Promise.all(expiredVideos.map(v => deleteExpiredTask(v.id))).then(() => {
                        toast({ title: '清理完成', description: `已删除 ${expiredVideos.length} 个过期视频` })
                    })
                }

                setAssets(validVideos)
            }
        } catch (error) {
            console.error('Failed to fetch assets:', error)
        } finally {
            setLoading(false)
        }
    }, [toast])

    useEffect(() => {
        if (open) {
            fetchAssets()
            setSelectedAssetIds([])
        }
    }, [open, fetchAssets])

    // 切换选择
    const toggleAssetSelection = (assetId: string) => {
        setSelectedAssetIds(prev =>
            prev.includes(assetId)
                ? prev.filter(id => id !== assetId)
                : [...prev, assetId]
        )
    }

    // 单个资产转存
    const transferSingleAsset = async (asset: AssetItem, retryCount = 0): Promise<SelectedVideo | null> => {
        if (selectedVideoIds.includes(asset.id)) return null

        setTransferringAssets(prev => new Set(prev).add(asset.id))

        try {
            const response = await fetch('/api/upload/transfer-to-oss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceUrl: asset.resultUrl,
                    filename: asset.prompt?.slice(0, 30) || 'video'
                })
            })

            const result = await response.json()

            if (!result.success || !result.data?.url) {
                throw new Error(result.error || '视频转存失败')
            }

            return {
                id: asset.id,
                type: 'asset',
                name: asset.prompt?.slice(0, 30) || `视频 ${format(new Date(asset.createdAt), 'MM/dd HH:mm')}`,
                thumbnail: asset.thumbnailUrl || '',
                url: result.data.url,
                localUrl: result.data.url,
                duration: 30
            }
        } catch (error) {
            console.error('Transfer failed:', error)
            if (retryCount < 1) {
                await new Promise(r => setTimeout(r, 1000))
                return transferSingleAsset(asset, retryCount + 1)
            }
            return null
        } finally {
            setTransferringAssets(prev => {
                const next = new Set(prev)
                next.delete(asset.id)
                return next
            })
        }
    }

    // 多文件转存
    const startBatchTransfer = async () => {
        const assetsToTransfer = selectedAssetIds
            .map(id => assets.find(a => a.id === id))
            .filter((a): a is AssetItem => !!a && !selectedVideoIds.includes(a.id))

        if (assetsToTransfer.length === 0) {
            onClose()
            return
        }

        setBatchTransfer({
            isTransferring: true,
            total: assetsToTransfer.length,
            completed: 0,
            failed: 0,
            currentBatch: []
        })

        let completed = 0
        let failed = 0
        const addedVideos: SelectedVideo[] = []

        // 分组处理
        for (let i = 0; i < assetsToTransfer.length; i += CONCURRENT_TRANSFER_LIMIT) {
            const chunk = assetsToTransfer.slice(i, i + CONCURRENT_TRANSFER_LIMIT)
            const chunkIds = chunk.map(a => a.id)

            setBatchTransfer(prev => ({ ...prev, currentBatch: chunkIds }))

            const results = await Promise.all(chunk.map(asset => transferSingleAsset(asset)))

            results.forEach(result => {
                if (result) {
                    completed++
                    addedVideos.push(result)
                } else {
                    failed++
                }
            })

            setBatchTransfer(prev => ({ ...prev, completed, failed }))
        }

        // 完成
        setBatchTransfer(prev => ({ ...prev, isTransferring: false, currentBatch: [] }))

        if (addedVideos.length > 0) {
            onVideosAdded(addedVideos)
        }

        if (failed > 0) {
            toast({
                variant: 'destructive',
                title: '多文件转存完成',
                description: `成功 ${completed} 个，失败 ${failed} 个`,
            })
        } else {
            toast({
                title: '✅ 多文件转存完成',
                description: `已添加 ${completed} 个视频到发布列表`,
            })
        }

        onClose()
    }

    // 双击快速添加
    const handleDoubleClick = async (asset: AssetItem) => {
        if (selectedVideoIds.includes(asset.id)) return
        if (transferringAssets.has(asset.id)) return

        setBatchTransfer({ isTransferring: true, total: 1, completed: 0, failed: 0, currentBatch: [asset.id] })

        const result = await transferSingleAsset(asset)

        setBatchTransfer({ isTransferring: false, total: 1, completed: result ? 1 : 0, failed: result ? 0 : 1, currentBatch: [] })

        if (result) {
            onVideosAdded([result])
            toast({ title: '✅ 视频已转存', description: '已添加到发布列表' })
            onClose()
        } else {
            toast({ variant: 'destructive', title: '转存失败', description: '请重试' })
        }
    }

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col bg-gray-900 border-gray-700">
                <DialogHeader className="flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <DialogTitle className="text-xl text-white">成品库</DialogTitle>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={fetchAssets}
                                disabled={loading}
                            >
                                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={onClose}>
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                    {selectedAssetIds.length > 0 && (
                        <div className="text-sm text-gray-400">
                            已选择 {selectedAssetIds.length} 个视频
                        </div>
                    )}
                </DialogHeader>

                {/* 资产网格 */}
                <div className="flex-1 overflow-y-auto py-4">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                        </div>
                    ) : assets.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            暂无可用视频
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-4">
                            {assets.map(asset => {
                                const isSelected = selectedAssetIds.includes(asset.id)
                                const isAdded = selectedVideoIds.includes(asset.id)
                                const isTransferring = transferringAssets.has(asset.id)

                                return (
                                    <div
                                        key={asset.id}
                                        onClick={() => !isAdded && !isTransferring && toggleAssetSelection(asset.id)}
                                        onDoubleClick={() => handleDoubleClick(asset)}
                                        className={`relative aspect-video rounded-lg overflow-hidden cursor-pointer group
                                            ${isSelected ? 'ring-2 ring-cyan-500' : ''}
                                            ${isAdded ? 'opacity-50 cursor-not-allowed' : ''}
                                        `}
                                    >
                                        <Image
                                            src={asset.thumbnailUrl || '/placeholder-video.png'}
                                            alt=""
                                            fill
                                            className="object-cover"
                                        />

                                        {/* 选中标记 */}
                                        {isSelected && (
                                            <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-cyan-500 flex items-center justify-center">
                                                <Check className="w-4 h-4 text-white" />
                                            </div>
                                        )}

                                        {/* 已添加标记 */}
                                        {isAdded && (
                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                <span className="text-sm text-white">已添加</span>
                                            </div>
                                        )}

                                        {/* 转存中 */}
                                        {isTransferring && (
                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                                            </div>
                                        )}

                                        {/* 标题 */}
                                        <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                                            <p className="text-xs text-white truncate">
                                                {asset.prompt?.slice(0, 30) || '无标题'}
                                            </p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* 底部操作栏 */}
                <div className="flex-shrink-0 pt-4 border-t border-gray-700 flex items-center justify-between">
                    {batchTransfer.isTransferring ? (
                        <div className="flex items-center gap-3">
                            <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                            <span className="text-sm text-gray-300">
                                转存中 {batchTransfer.completed}/{batchTransfer.total}
                            </span>
                        </div>
                    ) : (
                        <span className="text-sm text-gray-400">
                            双击快速添加
                        </span>
                    )}

                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={onClose}>
                            取消
                        </Button>
                        <Button
                            onClick={startBatchTransfer}
                            disabled={selectedAssetIds.length === 0 || batchTransfer.isTransferring}
                            className="bg-gradient-to-r from-cyan-500 to-pink-500"
                        >
                            添加 {selectedAssetIds.length} 个视频
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
