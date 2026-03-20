'use client'

// Shop Publish Settings — 发布设置表单
// Pattern: follows existing PublishSettings.tsx
// Fields: title, product_anchor_title, enable_precheck

import {
    Type,
    Tag,
    Shield,
    AlertCircle,
    Info,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

// ============================================================
// Types
// ============================================================

export interface ShopPublishSettingsData {
    title: string
    product_anchor_title: string
    enable_precheck: boolean
}

interface ShopPublishSettingsProps {
    value: ShopPublishSettingsData
    onChange: (value: ShopPublishSettingsData) => void
    errors?: Partial<Record<keyof ShopPublishSettingsData, string>>
}

// ============================================================
// Constants
// ============================================================

const TITLE_MAX_LENGTH = 150 // TikTok video title limit
const ANCHOR_MAX_LENGTH = 40  // Product anchor title limit

// ============================================================
// Component
// ============================================================

export function ShopPublishSettings({
    value,
    onChange,
    errors,
}: ShopPublishSettingsProps) {
    const updateField = <K extends keyof ShopPublishSettingsData>(
        field: K,
        fieldValue: ShopPublishSettingsData[K]
    ) => {
        onChange({ ...value, [field]: fieldValue })
    }

    return (
        <div className="space-y-6">
            {/* Section Title */}
            <div className="flex items-center gap-2">
                <div className="w-1 h-6 rounded-full bg-gradient-to-b from-[#CCFF00] to-[#00F2EA]" />
                <h3 className="text-lg font-semibold text-white">发布设置</h3>
            </div>

            {/* Video Title */}
            <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <Type className="w-4 h-4 text-cyan-400" />
                    视频标题
                    <span className="text-red-400">*</span>
                </Label>
                <div className="relative">
                    <Input
                        value={value.title}
                        onChange={(e) => updateField('title', e.target.value)}
                        placeholder="输入视频标题，让更多人看到你的商品..."
                        maxLength={TITLE_MAX_LENGTH}
                        className={cn(
                            'h-11 bg-white/5 border-white/10 pr-16',
                            errors?.title && 'border-red-500/50 focus:ring-red-500/30'
                        )}
                    />
                    <span className={cn(
                        'absolute right-3 top-1/2 -translate-y-1/2 text-xs',
                        value.title.length > TITLE_MAX_LENGTH * 0.9
                            ? 'text-amber-400'
                            : 'text-gray-500'
                    )}>
                        {value.title.length}/{TITLE_MAX_LENGTH}
                    </span>
                </div>
                {errors?.title && (
                    <p className="flex items-center gap-1 text-xs text-red-400">
                        <AlertCircle className="w-3 h-3" />
                        {errors.title}
                    </p>
                )}
                <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-white/5">
                    <Info className="w-3.5 h-3.5 text-gray-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-gray-500 leading-relaxed">
                        标题直接影响视频曝光量。建议包含商品关键词和吸引观众的短语。
                        TikTok 限制最多 {TITLE_MAX_LENGTH} 个字符。
                    </p>
                </div>
            </div>

            {/* Product Anchor Title */}
            <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <Tag className="w-4 h-4 text-pink-400" />
                    商品锚点文案
                </Label>
                <div className="relative">
                    <Input
                        value={value.product_anchor_title}
                        onChange={(e) => updateField('product_anchor_title', e.target.value)}
                        placeholder="例如：限时优惠 立即购买"
                        maxLength={ANCHOR_MAX_LENGTH}
                        className={cn(
                            'h-11 bg-white/5 border-white/10 pr-12',
                            errors?.product_anchor_title && 'border-red-500/50 focus:ring-red-500/30'
                        )}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                        {value.product_anchor_title.length}/{ANCHOR_MAX_LENGTH}
                    </span>
                </div>
                {errors?.product_anchor_title && (
                    <p className="flex items-center gap-1 text-xs text-red-400">
                        <AlertCircle className="w-3 h-3" />
                        {errors.product_anchor_title}
                    </p>
                )}
                <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-white/5">
                    <Info className="w-3.5 h-3.5 text-gray-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-gray-500 leading-relaxed">
                        锚点文案会显示在视频中的商品链接上，引导用户点击购买。留空则使用商品默认名称。
                    </p>
                </div>
            </div>

            {/* Precheck Toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                        <Shield className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                        <Label className="text-sm font-medium text-white cursor-pointer">
                            发布前预检
                        </Label>
                        <p className="text-xs text-gray-500 mt-0.5">
                            提交前自动检查视频是否符合 TikTok Shop 规范
                        </p>
                    </div>
                </div>
                <Switch
                    checked={value.enable_precheck}
                    onCheckedChange={(checked) => updateField('enable_precheck', checked)}
                />
            </div>
        </div>
    )
}
