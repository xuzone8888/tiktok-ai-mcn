'use client'

import { Calendar, Clock } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { PublishMode, PrivacyLevel, IntervalMode } from '@/types/publish'
import { cn } from '@/lib/utils'

interface PublishSettingsProps {
    // 任务组名称
    taskName: string
    onTaskNameChange: (name: string) => void
    // 发布模式
    publishMode: PublishMode
    onPublishModeChange: (mode: PublishMode) => void
    // 定时设置
    scheduledDate: string
    scheduledTime: string
    onScheduledDateChange: (date: string) => void
    onScheduledTimeChange: (time: string) => void
    // 间隔设置
    intervalMode: IntervalMode
    customInterval: number
    onIntervalModeChange: (mode: IntervalMode) => void
    onCustomIntervalChange: (interval: number) => void
    // 隐私设置
    privacyLevel: PrivacyLevel
    onPrivacyLevelChange: (level: PrivacyLevel) => void
}

const INTERVAL_OPTIONS = [
    { value: '0', label: '不间隔' },
    { value: '3', label: '3 分钟' },
    { value: '5', label: '5 分钟' },
    { value: '10', label: '10 分钟' },
    { value: '30', label: '30 分钟' },
    { value: '60', label: '1 小时' },
    { value: '120', label: '2 小时' },
    { value: '360', label: '6 小时' },
    { value: '720', label: '12 小时' },
    { value: '1440', label: '24 小时' },
    { value: 'custom', label: '自定义' },
]

const PRIVACY_OPTIONS = [
    { value: 'PUBLIC_TO_EVERYONE', label: '公开', desc: '所有人可见' },
    { value: 'MUTUAL_FOLLOW_FRIENDS', label: '朋友', desc: '互关好友可见' },
    { value: 'FOLLOWER_OF_CREATOR', label: '粉丝', desc: '粉丝可见' },
    { value: 'SELF_ONLY', label: '私密', desc: '仅自己可见' },
]

export function PublishSettings({
    taskName,
    onTaskNameChange,
    publishMode,
    onPublishModeChange,
    scheduledDate,
    scheduledTime,
    onScheduledDateChange,
    onScheduledTimeChange,
    intervalMode,
    customInterval,
    onIntervalModeChange,
    onCustomIntervalChange,
    privacyLevel,
    onPrivacyLevelChange,
}: PublishSettingsProps) {
    return (
        <div className="space-y-6">
            {/* 任务组名称 */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">任务组名称</label>
                <Input
                    value={taskName}
                    onChange={(e) => onTaskNameChange(e.target.value)}
                    placeholder="输入任务组名称，方便管理..."
                    className="bg-gray-800 border-gray-700 text-white"
                />
            </div>

            {/* 发布模式 */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-gray-300">发布方式</label>
                <div className="grid grid-cols-2 gap-3">
                    <button
                        onClick={() => onPublishModeChange('now')}
                        className={cn(
                            'p-4 rounded-xl border text-left transition-all',
                            publishMode === 'now'
                                ? 'bg-cyan-500/10 border-cyan-500/50'
                                : 'bg-white/5 border-white/10 hover:border-white/20'
                        )}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <Clock className="w-4 h-4 text-cyan-400" />
                            <span className="font-medium">立即发布</span>
                        </div>
                        <p className="text-xs text-gray-500">任务创建后立即开始发布</p>
                    </button>

                    <button
                        onClick={() => onPublishModeChange('scheduled')}
                        className={cn(
                            'p-4 rounded-xl border text-left transition-all',
                            publishMode === 'scheduled'
                                ? 'bg-cyan-500/10 border-cyan-500/50'
                                : 'bg-white/5 border-white/10 hover:border-white/20'
                        )}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <Calendar className="w-4 h-4 text-pink-400" />
                            <span className="font-medium">定时发布</span>
                        </div>
                        <p className="text-xs text-gray-500">设置首个视频的发布时间</p>
                    </button>
                </div>
            </div>

            {/* 定时设置 */}
            {publishMode === 'scheduled' && (
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm text-gray-400">发布日期</label>
                        <Input
                            type="date"
                            value={scheduledDate}
                            onChange={(e) => onScheduledDateChange(e.target.value)}
                            min={new Date().toISOString().split('T')[0]}
                            className="bg-gray-800 border-gray-700 text-white"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-gray-400">发布时间</label>
                        <Input
                            type="time"
                            value={scheduledTime}
                            onChange={(e) => onScheduledTimeChange(e.target.value)}
                            className="bg-gray-800 border-gray-700 text-white"
                        />
                    </div>
                </div>
            )}

            {/* 发布间隔 */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">发布间隔</label>
                <p className="text-xs text-gray-500">多个视频时，每个视频之间的发布间隔</p>
                <div className="flex gap-3">
                    <Select value={intervalMode} onValueChange={(v) => onIntervalModeChange(v as IntervalMode)}>
                        <SelectTrigger className="w-40 bg-gray-800 border-gray-700">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {INTERVAL_OPTIONS.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {intervalMode === 'custom' && (
                        <div className="flex items-center gap-2">
                            <Input
                                type="number"
                                value={customInterval}
                                onChange={(e) => onCustomIntervalChange(parseInt(e.target.value) || 5)}
                                min={1}
                                max={1440}
                                className="w-20 bg-gray-800 border-gray-700 text-white"
                            />
                            <span className="text-sm text-gray-400">分钟</span>
                        </div>
                    )}
                </div>
            </div>

            {/* 隐私设置 */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">可见范围</label>
                <div className="grid grid-cols-4 gap-2">
                    {PRIVACY_OPTIONS.map(opt => (
                        <button
                            key={opt.value}
                            onClick={() => onPrivacyLevelChange(opt.value as PrivacyLevel)}
                            className={cn(
                                'p-3 rounded-lg border text-center transition-all',
                                privacyLevel === opt.value
                                    ? 'bg-cyan-500/10 border-cyan-500/50'
                                    : 'bg-white/5 border-white/10 hover:border-white/20'
                            )}
                        >
                            <div className="font-medium text-sm">{opt.label}</div>
                            <div className="text-xs text-gray-500">{opt.desc}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
