'use client'

// Shop Publish Settings — publishing settings form
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
import { useLang } from '@/contexts/LangContext'
import SHOP_TEXT from './shop-publish.i18n'

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
const ANCHOR_MAX_LENGTH = 30  // Product anchor title limit (API error 16011007 if > 30)

// ============================================================
// Component
// ============================================================

export function ShopPublishSettings({
    value,
    onChange,
    errors,
}: ShopPublishSettingsProps) {
    const { lang } = useLang()
    const T = SHOP_TEXT.settings

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
                <h3 className="text-lg font-semibold text-white">{T.sectionTitle[lang]}</h3>
            </div>

            {/* Video Title */}
            <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <Type className="w-4 h-4 text-cyan-400" />
                    {T.videoTitle[lang]}
                    <span className="text-red-400">{T.required[lang]}</span>
                </Label>
                <div className="relative">
                    <Input
                        value={value.title}
                        onChange={(e) => updateField('title', e.target.value)}
                        placeholder={T.titlePlaceholder[lang]}
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
                        {T.titleHint[lang]} {T.titleLimit[lang].replace('{max}', String(TITLE_MAX_LENGTH))}
                    </p>
                </div>
            </div>

            {/* Product Anchor Title */}
            <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <Tag className="w-4 h-4 text-pink-400" />
                    {T.anchorText[lang]}
                </Label>
                <div className="relative">
                    <Input
                        value={value.product_anchor_title}
                        onChange={(e) => updateField('product_anchor_title', e.target.value)}
                        placeholder={T.anchorPlaceholder[lang]}
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
                        {T.anchorHint[lang]}
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
                            {T.precheckLabel[lang]}
                        </Label>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {T.precheckDesc[lang]}
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
