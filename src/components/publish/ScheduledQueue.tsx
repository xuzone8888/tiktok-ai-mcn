'use client'

import { useState, useEffect, useCallback } from 'react'
import { Timer, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { PublishTask } from '@/types/publish'
import { TaskGroupCard, TaskGroup } from './TaskGroupCard'
import { TaskGroupDetail } from './TaskGroupDetail'

export function ScheduledQueue() {
    const { toast } = useToast()
    const [tasks, setTasks] = useState<TaskGroup[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedTask, setSelectedTask] = useState<TaskGroup | null>(null)
    const [showDetail, setShowDetail] = useState(false)

    const fetchTasks = useCallback(async () => {
        setLoading(true)
        try {
            const response = await fetch('/api/publish/tasks')
            if (response.ok) {
                const data = await response.json()
                // 转换为 TaskGroup 格式
                const scheduledTasks = (data.tasks || [])
                    .filter((t: PublishTask) =>
                        ['scheduled', 'pending', 'processing'].includes(t.status) ||
                        (t.pending_count && t.pending_count > 0)
                    )
                    .map((t: PublishTask): TaskGroup => ({
                        id: t.id,
                        name: t.name || '未命名任务组',
                        status: t.status as TaskGroup['status'],
                        total_items: t.total_items,
                        published_count: t.published_count || t.completed_items || 0,
                        pending_count: t.pending_count || (t.total_items - t.completed_items - t.failed_items) || 0,
                        failed_count: t.failed_items || 0,
                        created_at: t.created_at,
                        scheduled_at: t.scheduled_at
                    }))
                setTasks(scheduledTasks)
            }
        } catch (error) {
            console.error('Failed to fetch tasks:', error)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchTasks()
    }, [fetchTasks])

    // 查看任务详情
    const handleViewDetail = (taskId: string) => {
        const task = tasks.find(t => t.id === taskId)
        if (task) {
            setSelectedTask(task)
            setShowDetail(true)
        }
    }

    // 停止待发布
    const handleCancelPending = async (taskId: string) => {
        try {
            const response = await fetch(`/api/publish/tasks/${taskId}/cancel-pending`, {
                method: 'POST'
            })
            const data = await response.json()

            if (response.ok) {
                toast({
                    title: '已停止待发布任务',
                    description: `${data.cancelledCount} 个任务已取消`
                })
                fetchTasks()
            } else {
                toast({
                    variant: 'destructive',
                    title: '操作失败',
                    description: data.error
                })
            }
        } catch (error) {
            console.error('Failed to cancel pending:', error)
            toast({ variant: 'destructive', title: '操作失败' })
        }
    }

    // 删除任务项
    const handleDeleteItem = async (itemId: string, deleteTikTokVideo: boolean) => {
        if (!selectedTask) return

        try {
            const response = await fetch(
                `/api/publish/tasks/${selectedTask.id}/items/${itemId}`,
                {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deleteTikTokVideo })
                }
            )

            if (response.ok) {
                toast({ title: '任务项已删除' })
                // 刷新任务列表
                fetchTasks()
            } else {
                const data = await response.json()
                toast({ variant: 'destructive', title: '删除失败', description: data.error })
            }
        } catch (error) {
            console.error('Failed to delete item:', error)
            toast({ variant: 'destructive', title: '删除失败' })
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
        )
    }

    if (tasks.length === 0) {
        return (
            <div className="text-center py-12">
                <Timer className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400">暂无定时任务</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">定时队列</h2>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={fetchTasks}
                    disabled={loading}
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </div>

            <div className="space-y-3">
                {tasks.map(task => (
                    <TaskGroupCard
                        key={task.id}
                        task={task}
                        onViewDetail={handleViewDetail}
                        onCancelPending={handleCancelPending}
                    />
                ))}
            </div>

            {/* 任务详情弹窗 */}
            <TaskGroupDetail
                task={selectedTask}
                open={showDetail}
                onClose={() => {
                    setShowDetail(false)
                    setSelectedTask(null)
                }}
                onDeleteItem={handleDeleteItem}
                onCancelPending={handleCancelPending}
            />
        </div>
    )
}
