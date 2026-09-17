'use client'
import { useTikTokLanguage } from '@/hooks/use-tiktok-language'


import { PublishTaskFilters } from "./PublishTaskFilters"
import { useState, useEffect, useCallback, useRef } from 'react'
import { AlertTriangle, Trash2, ListTodo } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { TaskGroupCard, TaskGroup } from './TaskGroupCard'
import { TaskOverview } from './TaskOverview'
import { TaskGroupDetail } from './TaskGroupDetail'
import { useToast } from '@/hooks/use-toast'
import { useLatestPublishRequest } from '@/hooks/use-latest-publish-request'
import { clearLocalTaskPreviews } from '@/lib/publish/local-task-preview'

type DateRange = 'today' | 'yesterday' | '3days' | '7days'

export function TaskManager() {
  const { tr, isEnglish, locale } = useTikTokLanguage()

    const { toast } = useToast()
    const [activeTab, setActiveTab] = useState('all')
    const [dateRange, setDateRange] = useState<DateRange>('today')
    const [tasks, setTasks] = useState<TaskGroup[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(true)

    // Detail view state
    const [selectedTask, setSelectedTask] = useState<TaskGroup | null>(null)
    const [detailOpen, setDetailOpen] = useState(false)

    // Delete dialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [taskToDelete, setTaskToDelete] = useState<TaskGroup | null>(null)
    const [deleting, setDeleting] = useState(false)
    const requestGate = useLatestPublishRequest()

    const fetchTasks = useCallback(async (reset = false, pageToLoad = 1, refreshLoaded = false) => {
        const request = requestGate.begin()
        setLoading(true)
        try {
            const requestedLimit = refreshLoaded ? pageToLoad * 20 : 20
            const params = new URLSearchParams({
                limit: String(requestedLimit),
                offset: reset ? '0' : ((pageToLoad - 1) * 20).toString(),
                dateRange: dateRange
            })

            if (activeTab !== 'all') {
                params.append('status', activeTab)
            }

            const res = await fetch(`/api/publish/tasks?${params}`, { signal: request.signal })
            const data = await res.json()
            if (!request.isCurrent()) return
            if (!res.ok) throw new Error(tr('无法获取任务列表'))

            if (res.ok) {
                const receivedTasks = data.tasks || []
                if (reset) {
                    setTasks(receivedTasks)
                    setSelectedTask(current => (
                        current
                            ? receivedTasks.find((task: TaskGroup) => task.id === current.id) || current
                            : null
                    ))
                } else {
                    setTasks(prev => [...new Map([...prev, ...receivedTasks].map(task => [task.id, task])).values()])
                }
                setPage(reset && !refreshLoaded ? 1 : pageToLoad)
                setHasMore(receivedTasks.length === requestedLimit)
            }
        } catch (error) {
            if (!request.isCurrent()) return
            console.error('Fetch tasks failed:', error)
            toast({
                title: tr('加载失败'),
                description: tr('无法获取任务列表'),
                variant: 'destructive',
            })
        } finally {
            if (request.isCurrent()) setLoading(false)
        }
    }, [activeTab, dateRange, requestGate, toast, tr])

    // Initial load & Tab/DateRange change
    useEffect(() => {
        setTasks([])
        setPage(1)
        fetchTasks(true)
        return () => requestGate.cancel()
    }, [fetchTasks, requestGate])

    // 自动轮询：有进行中的任务时每 10 秒刷新
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
    useEffect(() => {
        const hasActive = tasks.some(t =>
            ['pending', 'running', 'scheduled'].includes(t.status)
            || (t.active_count || 0) > 0
            || (t.confirming_count || 0) > 0
        )
        if (hasActive) {
            if (!pollRef.current) {
                pollRef.current = setInterval(() => {
                    if (!loading) void fetchTasks(true, page, true)
                }, 10_000)
            }
        } else {
            if (pollRef.current) {
                clearInterval(pollRef.current)
                pollRef.current = null
            }
        }
        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current)
                pollRef.current = null
            }
        }
    }, [tasks, fetchTasks, page, loading])


    const handleViewDetail = (taskId: string) => {
        const task = tasks.find(t => t.id === taskId)
        if (task) {
            setSelectedTask(task)
            setDetailOpen(true)
        }
    }

    const handleDeleteTask = (task: TaskGroup) => {
        setTaskToDelete(task)
        setDeleteDialogOpen(true)
    }

    const confirmDeleteTask = async () => {
        if (!taskToDelete) return

        setDeleting(true)
        try {
            const res = await fetch(`/api/publish/tasks/${taskToDelete.id}`, {
                method: 'DELETE'
            })

            const data = await res.json()

            if (!res.ok) throw new Error(data.error || tr('删除失败'))
            requestGate.cancel()
            setLoading(false)

            // 如果有已发布视频，提示用户去TikTok手动删除
            if (taskToDelete.published_count > 0) {
                toast({
                    title: tr('任务组已删除'),
                    description: tr("请前往 TikTok App 手动删除 {0} 个已发布视频", taskToDelete.published_count),
                })
            } else {
                toast({ title: tr('任务组已删除') })
            }

            // Remove from local state
            clearLocalTaskPreviews('delete')
            setTasks(prev => prev.filter(t => t.id !== taskToDelete.id))
            setDeleteDialogOpen(false)
            setTaskToDelete(null)

        } catch (error: any) {
            toast({
                title: tr('删除失败'),
                description: error.message,
                variant: 'destructive',
            })
        } finally {
            setDeleting(false)
        }
    }

    const handleDeleteItem = async (itemId: string) => {
        if (!selectedTask) return false
        try {
            const res = await fetch(`/api/publish/tasks/${selectedTask.id}/items/${itemId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deleteTikTokVideo: false })
            })

            const data = await res.json()

            if (!res.ok) throw new Error(data.error || tr('删除失败'))

            clearLocalTaskPreviews('delete')

            toast({
                title: tr('本地记录已删除'),
                description: data.deletedItemStatus === 'published'
                    ? tr('TikTok 线上视频未被删除')
                    : tr('任务统计已更新'),
            })
            await fetchTasks(true)
            return true

        } catch (error: any) {
            toast({
                title: tr('操作失败'),
                description: error.message,
                variant: 'destructive',
            })
            return false
        }
    }

    const handleCancelPending = async (taskId: string) => {
        try {
            const res = await fetch(`/api/publish/tasks/${taskId}/cancel-pending`, {
                method: 'POST'
            })
            if (!res.ok) throw new Error(tr('取消失败'))

            toast({ title: tr('已取消所有待发布任务') })
            fetchTasks(true)
        } catch (error) {
            toast({
                title: tr('取消失败'),
                variant: 'destructive',
            })
        }
    }

    const filteredTasks = tasks.filter(task => !searchQuery.trim() || [task.name, ...(task.video_search_titles || (task.video_previews || []).map(video => video.title))].some(title => title?.toLowerCase().includes(searchQuery.trim().toLowerCase())))

    return (
        <div className="space-y-4">
            <TaskOverview tasks={filteredTasks} loading={loading} />
            <PublishTaskFilters isEnglish={isEnglish} status={activeTab} onStatusChange={setActiveTab} dateRange={dateRange} onDateRangeChange={value => setDateRange(value as DateRange)} search={searchQuery} onSearchChange={setSearchQuery} loading={loading} onRefresh={() => { setPage(1); void fetchTasks(true) }} />

            {/* 任务列表 */}
            {loading && page === 1 && tasks.length === 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 items-start gap-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="rounded-xl border border-white/5 bg-zinc-900/40 p-5 animate-pulse">
                            <div className="flex items-start justify-between mb-4">
                                <div className="h-5 bg-white/[0.08] rounded w-2/3" />
                                <div className="h-5 bg-white/[0.08] rounded w-16" />
                            </div>
                            <div className="grid grid-cols-3 gap-3 mb-4">
                                <div className="h-10 bg-white/[0.08] rounded" />
                                <div className="h-10 bg-white/[0.08] rounded" />
                                <div className="h-10 bg-white/[0.08] rounded" />
                            </div>
                            <div className="h-4 bg-white/[0.08] rounded w-1/3 mt-4" />
                        </div>
                    ))}
                </div>
            ) : filteredTasks.length === 0 ? (
                <div className="text-center py-16 bg-white/[0.02] border rounded-xl border-dashed border-white/10">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                        <ListTodo className="w-7 h-7 text-zinc-600" />
                    </div>
                    <p className="text-zinc-400 mb-1">{searchQuery.trim() ? tr('没有匹配的任务或视频') : tr('暂无任务数据')}</p>
                    <p className="text-xs text-zinc-600 mb-5">{tr("创建发布任务后，这里会展示任务状态和数据统计")}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 items-start gap-3">
                    {filteredTasks
                        .map(task => (
                        <TaskGroupCard
                            key={task.id}
                            task={task}
                            onViewDetail={handleViewDetail}
                            onCancelPending={handleCancelPending}
                            onDelete={handleDeleteTask}
                        />
                    ))}
                </div>
            )}

            {hasMore && !loading && tasks.length > 0 && (
                <div className="flex justify-center pt-4">
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => void fetchTasks(false, page + 1)}
                        className="border-white/10 hover:border-white/20 text-zinc-400 hover:text-white transition-colors"
                    >
                        {tr("加载更多任务")}</Button>
                </div>
            )}



            {/* 任务详情弹窗 */}
            <TaskGroupDetail
                task={selectedTask}
                open={detailOpen}
                onClose={() => setDetailOpen(false)}
                onDeleteItem={handleDeleteItem}
                onCancelPending={handleCancelPending}
            />

            {/* 删除确认对话框 */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent className="bg-gray-900 border-white/10">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-white flex items-center gap-2">
                            <Trash2 className="w-5 h-5 text-red-400" />
                            {tr("删除任务组")}</AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            {tr("确定要删除任务组 &quot;")}{taskToDelete?.name || tr('未命名任务组')}{tr("&quot; 吗？")}{taskToDelete && taskToDelete.published_count > 0 && (
                                <span className="block mt-2 text-amber-400">
                                    {tr("此任务组有")}{taskToDelete.published_count} {tr("个已发布视频")}</span>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    {/* 提示信息 */}
                    {taskToDelete && taskToDelete.published_count > 0 && (
                        <div className="py-4">
                            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="text-amber-300 font-medium">{tr("已发布视频需手动删除")}</p>
                                    <p className="text-gray-400 text-sm mt-1">
                                        {tr("TikTok不支持通过API删除视频。此任务组中的")}{taskToDelete.published_count} {tr("个已发布视频需要您前往 TikTok App 手动删除。")}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-white/5 border-white/10 text-gray-300 hover:bg-white/10">
                            {tr("取消")}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDeleteTask}
                            disabled={deleting}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {deleting ? tr('删除中...') : tr('确认删除')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
