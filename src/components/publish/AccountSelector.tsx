'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { Users, Loader2, RefreshCw, AlertCircle, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TikTokAccount } from '@/types/publish'
import { cn } from '@/lib/utils'

interface AccountSelectorProps {
    selectedAccountIds: string[]
    onSelectionChange: (accountIds: string[]) => void
    mode?: 'single' | 'multiple'
}

export function AccountSelector({
    selectedAccountIds,
    onSelectionChange,
    mode = 'single'
}: AccountSelectorProps) {
    const [accounts, setAccounts] = useState<TikTokAccount[]>([])
    const [loading, setLoading] = useState(true)

    const fetchAccounts = useCallback(async () => {
        setLoading(true)
        try {
            const response = await fetch('/api/publish/accounts')
            if (response.ok) {
                const data = await response.json()
                setAccounts(data.accounts || [])
            }
        } catch (error) {
            console.error('Failed to fetch accounts:', error)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchAccounts()
    }, [fetchAccounts])

    // 检查账号是否已授权
    const isAccountAuthorized = (account: TikTokAccount) => {
        return new Date(account.token_expires_at) > new Date()
    }

    // 切换账号选择
    const toggleSelection = (accountId: string) => {
        if (mode === 'single') {
            onSelectionChange(
                selectedAccountIds.includes(accountId) ? [] : [accountId]
            )
        } else {
            onSelectionChange(
                selectedAccountIds.includes(accountId)
                    ? selectedAccountIds.filter(id => id !== accountId)
                    : [...selectedAccountIds, accountId]
            )
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
        )
    }

    if (accounts.length === 0) {
        return (
            <div className="text-center py-8">
                <Users className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400 mb-4">暂无可用账号</p>
                <Button
                    variant="outline"
                    onClick={() => window.location.href = '/publish/accounts'}
                    className="text-cyan-400 border-cyan-500/50"
                >
                    绑定 TikTok 账号
                </Button>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">
                    {mode === 'single' ? '选择发布账号' : `已选 ${selectedAccountIds.length} 个账号`}
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={fetchAccounts}
                    className="text-gray-400 hover:text-white"
                >
                    <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {accounts.map(account => {
                    const isAuthorized = isAccountAuthorized(account)
                    const isSelected = selectedAccountIds.includes(account.id)

                    return (
                        <div
                            key={account.id}
                            onClick={() => isAuthorized && toggleSelection(account.id)}
                            className={cn(
                                'relative p-3 rounded-xl border transition-all cursor-pointer',
                                isSelected
                                    ? 'bg-cyan-500/10 border-cyan-500/50'
                                    : 'bg-white/5 border-white/10 hover:border-white/20',
                                !isAuthorized && 'opacity-50 cursor-not-allowed'
                            )}
                        >
                            <div className="flex items-center gap-3">
                                {/* 头像 */}
                                <div className="relative">
                                    {account.avatar_url ? (
                                        <Image
                                            src={account.avatar_url}
                                            alt={account.display_name}
                                            width={40}
                                            height={40}
                                            className="rounded-full"
                                        />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center text-white font-bold">
                                            {account.display_name[0]}
                                        </div>
                                    )}

                                    {/* 选中标记 */}
                                    {isSelected && (
                                        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center">
                                            <Check className="w-3 h-3 text-white" />
                                        </div>
                                    )}
                                </div>

                                {/* 账号信息 */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium truncate">
                                            {account.display_name}
                                        </span>
                                        {!isAuthorized && (
                                            <span className="text-xs text-red-400 flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3" />
                                                已过期
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-gray-500">
                                        <span>{(account.follower_count / 1000).toFixed(1)}K 粉丝</span>
                                        <span>{account.video_count} 视频</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
