'use client'

import { useState, useEffect, useCallback } from 'react'
import { History, Loader2, Trash2, CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { PublishTask } from '@/types/publish'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

const statusConfig = {
    pending: { label: '待处理', color: 'bg-gray-500', icon: Clock },
    scheduled: { label: '定时中', color: 'bg-blue-500', icon: Clock },
    processing: { label: '执行中', color: 'bg-yellow-500', icon: Loader2 },
    completed: { label: '已完成', color: 'bg-green-500', icon: CheckCircle2 },
    failed: { label: '失败', color: 'bg-red-500', icon: XCircle },
    partial_failed: { label: '部分失败', color: 'bg-orange-500', icon: AlertTriangle },
    cancelled: { label: '已取消', color: 'bg-gray-400', icon: XCircle },
}

export function TaskHistory() {
    const [tasks, setTasks] = useState<PublishTask[]>([])
    const [loading, setLoading] = useState(false)
    const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)

    const fetchTasks = useCallback(async () => {
        setLoading(true)
        try {
            const response = await fetch('/api/publish/tasks')
            if (response.ok) {
                const data = await response.json()
                // 只显示非定时的任务（历史记录）
                const historyTasks = (data.tasks || []).filter(
                    (t: PublishTask) => t.status !== 'scheduled'
                )
                setTasks(historyTasks)
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

    const deleteTask = async (taskId: string) => {
        setDeleting(true)
        try {
            const response = await fetch(`/api/publish/tasks/${taskId}`, {
                method: 'DELETE'
            })
            if (response.ok) {
                setTasks(prev => prev.filter(t => t.id !== taskId))
                setDeleteTaskId(null)
            }
        } catch (error) {
            console.error('Failed to delete task:', error)
        } finally {
            setDeleting(false)
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
                <History className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400">暂无发布记录</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">发布记录</h2>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={fetchTasks}
                    disabled={loading}
                >
                    <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
                </Button>
            </div>

            <div className="space-y-3">
                {tasks.map(task => {
                    const config = statusConfig[task.status] || statusConfig.pending
                    const StatusIcon = config.icon

                    return (
                        <div
                            key={task.id}
                            className="p-4 bg-white/5 rounded-xl border border-white/10 hover:border-white/20 transition-colors"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="font-medium text-white">
                                            {task.name || '未命名任务'}
                                        </span>
                                        <Badge className={cn('text-white text-xs', config.color)}>
                                            <StatusIcon className={cn(
                                                'w-3 h-3 mr-1',
                                                task.status === 'processing' && 'animate-spin'
                                            )} />
                                            {config.label}
                                        </Badge>
                                    </div>

                                    <div className="flex items-center gap-4 text-sm text-gray-400">
                                        <span>{task.total_items} 个任务</span>
                                        {task.completed_items > 0 && (
                                            <span className="text-green-400">
                                                {task.completed_items} 成功
                                            </span>
                                        )}
                                        {task.failed_items > 0 && (
                                            <span className="text-red-400">
                                                {task.failed_items} 失败
                                            </span>
                                        )}
                                        <span>
                                            {format(new Date(task.created_at), 'MM/dd HH:mm')}
                                        </span>
                                    </div>
                                </div>

                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDeleteTaskId(task.id)}
                                    className="text-gray-400 hover:text-red-400"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* 删除确认对话框 */}
            <AlertDialog open={!!deleteTaskId} onOpenChange={() => setDeleteTaskId(null)}>
                <AlertDialogContent className="bg-gray-900 border-gray-700">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-white">确认删除</AlertDialogTitle>
                        <AlertDialogDescription>
                            确定要删除这个发布任务吗？此操作无法撤销。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteTaskId && deleteTask(deleteTaskId)}
                            disabled={deleting}
                            className="bg-red-500 hover:bg-red-600"
                        >
                            {deleting ? '删除中...' : '删除'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
