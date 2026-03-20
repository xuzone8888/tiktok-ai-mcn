"use client";

// TikTok Shop 橱窗视频发布主页面
// 5-step workflow: 选视频 → 选账号 → 选商品 → 设置 → 确认发布
// Bottom section: task history (ShopTaskManager)

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Video,
    ShoppingBag,
    Users,
    Settings,
    Send,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Check,
    AlertCircle,
    Store,
    Play,
    Package,
    RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ShopProductSelector } from "@/components/shop-publish/ShopProductSelector";
import {
    ShopPublishSettings,
    type ShopPublishSettingsData,
} from "@/components/shop-publish/ShopPublishSettings";
import { ShopTaskManager } from "@/components/shop-publish/ShopTaskManager";

// ============================================================
// Types
// ============================================================

interface ShopAccount {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    username: string | null;
    status: string;
    token_expires_at: string;
    account_type: string;
}

interface SelectedProduct {
    id: string;
    shop: { name: string };
    addition: {
        customized_main_images: { url: string; width: number; height: number }[];
    };
    price: {
        original_price: {
            minimum_amount: string;
            maximum_amount: string;
        };
    };
    commission_rate?: number;
    status: string;
}

interface VideoSource {
    url: string;
    source: 'assets' | 'upload' | 'url';
    name: string;
    thumbnail?: string;
}

// ============================================================
// Step Configuration
// ============================================================

const STEPS = [
    { id: 1, label: '选择视频', icon: Video },
    { id: 2, label: '选择账号', icon: Users },
    { id: 3, label: '选择商品', icon: ShoppingBag },
    { id: 4, label: '发布设置', icon: Settings },
    { id: 5, label: '确认发布', icon: Send },
] as const;

// ============================================================
// Page Component
// ============================================================

export default function ShopPublishPage() {
    const { toast } = useToast();
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState(1);
    const [submitting, setSubmitting] = useState(false);

    // Step data
    const [videoSource, setVideoSource] = useState<VideoSource | null>(null);
    const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [publishSettings, setPublishSettings] = useState<ShopPublishSettingsData>({
        title: '',
        product_anchor_title: '',
        enable_precheck: false,
    });

    // Account list for step 3
    const [accounts, setAccounts] = useState<ShopAccount[]>([]);
    const [accountsLoading, setAccountsLoading] = useState(false);

    // Validation errors
    const [settingsErrors, setSettingsErrors] = useState<Partial<Record<keyof ShopPublishSettingsData, string>>>({});

    // ============================================================
    // Fetch Accounts
    // ============================================================

    const fetchAccounts = useCallback(async () => {
        setAccountsLoading(true);
        try {
            const res = await fetch('/api/shop-publish/accounts');
            if (!res.ok) throw new Error('获取账号失败');
            const data = await res.json();
            setAccounts(data.accounts || []);
        } catch (error) {
            console.error('Failed to fetch Shop accounts:', error);
            toast({
                variant: 'destructive',
                title: '加载账号失败',
                description: '无法获取 Shop 账号列表',
            });
        } finally {
            setAccountsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAccounts();
    }, [fetchAccounts]);

    // ============================================================
    // Step Validation
    // ============================================================

    const isStepComplete = (step: number): boolean => {
        switch (step) {
            case 1: return !!videoSource;
            case 2: return !!selectedAccountId;
            case 3: return !!selectedProduct;
            case 4: return !!publishSettings.title.trim();
            case 5: return true;
            default: return false;
        }
    };

    const canProceed = isStepComplete(currentStep);

    const validateSettings = (): boolean => {
        const errors: Partial<Record<keyof ShopPublishSettingsData, string>> = {};

        if (!publishSettings.title.trim()) {
            errors.title = '请输入视频标题';
        } else if (publishSettings.title.length > 150) {
            errors.title = '标题不能超过 150 个字符';
        }

        if (publishSettings.product_anchor_title.length > 40) {
            errors.product_anchor_title = '锚点文案不能超过 40 个字符';
        }

        setSettingsErrors(errors);
        return Object.keys(errors).length === 0;
    };

    // ============================================================
    // Navigation
    // ============================================================

    const goNext = () => {
        if (currentStep === 4) {
            if (!validateSettings()) return;
        }
        if (currentStep < 5 && canProceed) {
            setCurrentStep(s => s + 1);
        }
    };

    const goPrev = () => {
        if (currentStep > 1) {
            setCurrentStep(s => s - 1);
        }
    };

    const goToStep = (step: number) => {
        // Can only go to completed steps or next step
        if (step <= currentStep || (step === currentStep + 1 && canProceed)) {
            if (step === 5 && currentStep === 4) {
                if (!validateSettings()) return;
            }
            setCurrentStep(step);
        }
    };

    // ============================================================
    // Submit
    // ============================================================

    const handleSubmit = async () => {
        if (!videoSource || !selectedProduct || !selectedAccountId || !publishSettings.title.trim()) {
            toast({
                variant: 'destructive',
                title: '信息不完整',
                description: '请完成所有步骤',
            });
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch('/api/shop-publish/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_name: `Shop 发布 - ${publishSettings.title.substring(0, 30)}`,
                    title_template: publishSettings.title,
                    enable_precheck: publishSettings.enable_precheck,
                    items: [
                        {
                            account_id: selectedAccountId,
                            video_url: videoSource.url,
                            video_source: videoSource.source,
                            title: publishSettings.title,
                            product_id: selectedProduct.id,
                            product_anchor_title: publishSettings.product_anchor_title || undefined,
                        },
                    ],
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || '创建任务失败');
            }

            toast({
                title: '任务创建成功',
                description: '视频发布任务已创建，可在下方查看进度',
            });

            // Reset form
            setVideoSource(null);
            setSelectedProduct(null);
            setSelectedAccountId(null);
            setPublishSettings({
                title: '',
                product_anchor_title: '',
                enable_precheck: false,
            });
            setCurrentStep(1);
        } catch (error) {
            console.error('Failed to create task:', error);
            toast({
                variant: 'destructive',
                title: '创建失败',
                description: error instanceof Error ? error.message : '任务创建失败',
            });
        } finally {
            setSubmitting(false);
        }
    };

    // ============================================================
    // Account token check
    // ============================================================

    const isAccountTokenValid = (account: ShopAccount) => {
        return new Date(account.token_expires_at) > new Date() && account.status === 'active';
    };

    // ============================================================
    // Render
    // ============================================================

    return (
        <div className="space-y-8">
            {/* Page Header */}
            <div className="flex items-center gap-4">
                <div className="w-1.5 h-14 rounded-full bg-gradient-to-b from-[#CCFF00] via-[#00F2EA] to-[#EC4899]" />
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <ShoppingBag className="h-6 w-6" />
                        橱窗视频发布
                    </h1>
                    <p className="text-white/50 text-sm mt-0.5">
                        发布带商品链接的视频到 TikTok Shop
                    </p>
                </div>
            </div>

            {/* Step Progress Indicator */}
            <div className="flex items-center gap-1">
                {STEPS.map((step, index) => {
                    const Icon = step.icon;
                    const isActive = currentStep === step.id;
                    const isCompleted = currentStep > step.id || (step.id < currentStep && isStepComplete(step.id));
                    const isClickable = step.id <= currentStep || (step.id === currentStep + 1 && canProceed);

                    return (
                        <div key={step.id} className="flex items-center flex-1">
                            <button
                                onClick={() => goToStep(step.id)}
                                disabled={!isClickable}
                                className={cn(
                                    'flex items-center gap-2 px-3 py-2 rounded-lg transition-all w-full',
                                    isActive
                                        ? 'bg-gradient-to-r from-cyan-500/20 to-pink-500/20 border border-cyan-500/30'
                                        : isCompleted
                                            ? 'bg-green-500/10 border border-green-500/20'
                                            : 'bg-white/5 border border-white/5',
                                    isClickable ? 'cursor-pointer hover:bg-white/10' : 'cursor-not-allowed opacity-50'
                                )}
                            >
                                <div className={cn(
                                    'w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold',
                                    isActive
                                        ? 'bg-cyan-500 text-white'
                                        : isCompleted
                                            ? 'bg-green-500 text-white'
                                            : 'bg-white/10 text-gray-400'
                                )}>
                                    {isCompleted && !isActive ? (
                                        <Check className="w-3.5 h-3.5" />
                                    ) : (
                                        <Icon className="w-3.5 h-3.5" />
                                    )}
                                </div>
                                <span className={cn(
                                    'text-xs font-medium truncate',
                                    isActive ? 'text-white' : 'text-gray-500'
                                )}>
                                    {step.label}
                                </span>
                            </button>
                            {index < STEPS.length - 1 && (
                                <ChevronRight className="w-4 h-4 text-gray-600 shrink-0 mx-1" />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Step Content */}
            <div className="min-h-[400px] bg-white/5 rounded-2xl border border-white/10 p-6">
                {/* Step 1: Select Video */}
                {currentStep === 1 && (
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-white">选择要发布的视频</h2>
                        <p className="text-sm text-gray-500">
                            输入视频 URL 或从成品库选择视频
                        </p>

                        {/* Simple URL input for now — can be enhanced with VideoUploader in future */}
                        <div className="space-y-3">
                            <div className="relative">
                                <Video className="absolute left-3 top-3 h-5 w-5 text-gray-500" />
                                <input
                                    type="url"
                                    value={videoSource?.url || ''}
                                    onChange={(e) => {
                                        const url = e.target.value;
                                        if (url) {
                                            setVideoSource({
                                                url,
                                                source: 'url',
                                                name: url.split('/').pop() || 'video',
                                            });
                                        } else {
                                            setVideoSource(null);
                                        }
                                    }}
                                    placeholder="输入视频文件的 URL 地址..."
                                    className="w-full h-12 pl-11 pr-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                                />
                            </div>

                            {videoSource && (
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                                    <Play className="w-5 h-5 text-green-400" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-green-300 truncate">{videoSource.name}</p>
                                        <p className="text-xs text-gray-500">来源: {videoSource.source}</p>
                                    </div>
                                    <Badge variant="outline" className="text-green-400 border-green-500/30">
                                        已选择
                                    </Badge>
                                </div>
                            )}
                        </div>

                        <div className="flex items-start gap-2 p-3 rounded-lg bg-white/5 text-xs text-gray-500">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <p>
                                支持 MP4 格式视频。建议 720p 以上分辨率，时长 15 秒至 10 分钟。
                                视频将通过 TikTok Shop API 上传，请确保视频内容符合平台规范。
                            </p>
                        </div>
                    </div>
                )}

                {/* Step 2: Select Account (BEFORE products — products depend on account) */}
                {currentStep === 2 && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-white">选择发布账号</h2>
                                <p className="text-sm text-gray-500">
                                    选择一个 Shop 账号，用于获取橱窗商品和发布视频
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={fetchAccounts}
                                className="text-gray-400 hover:text-white"
                            >
                                <RefreshCw className={cn('w-4 h-4', accountsLoading && 'animate-spin')} />
                            </Button>
                        </div>

                        {accountsLoading ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                            </div>
                        ) : accounts.length === 0 ? (
                            <div className="text-center py-12">
                                <Store className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                                <p className="text-sm text-gray-500 mb-4">暂无 Shop 账号</p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => router.push('/shop-publish/accounts')}
                                >
                                    前往绑定
                                </Button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                {accounts.map(account => {
                                    const isValid = isAccountTokenValid(account);
                                    const isSelected = selectedAccountId === account.id;

                                    return (
                                        <div
                                            key={account.id}
                                            onClick={() => {
                                                if (!isValid) return;
                                                const newId = isSelected ? null : account.id;
                                                setSelectedAccountId(newId);
                                                // Clear product selection when account changes
                                                if (newId !== selectedAccountId) {
                                                    setSelectedProduct(null);
                                                }
                                            }}
                                            className={cn(
                                                'relative p-3 rounded-xl border transition-all cursor-pointer',
                                                isSelected
                                                    ? 'bg-cyan-500/10 border-cyan-500/50'
                                                    : 'bg-white/5 border-white/10 hover:border-white/20',
                                                !isValid && 'opacity-50 cursor-not-allowed'
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="relative">
                                                    {account.avatar_url ? (
                                                        <img
                                                            src={account.avatar_url}
                                                            alt={account.display_name || 'Shop'}
                                                            className="w-10 h-10 rounded-full object-cover"
                                                        />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#00F2EA] to-[#EC4899] flex items-center justify-center text-white font-bold">
                                                            {(account.display_name || 'S').charAt(0)}
                                                        </div>
                                                    )}
                                                    {isSelected && (
                                                        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center">
                                                            <Check className="w-3 h-3 text-white" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-white truncate">
                                                            {account.display_name || 'Shop 账号'}
                                                        </span>
                                                        {!isValid && (
                                                            <span className="text-xs text-red-400 flex items-center gap-1">
                                                                <AlertCircle className="w-3 h-3" />
                                                                已过期
                                                            </span>
                                                        )}
                                                    </div>
                                                    {account.username && (
                                                        <p className="text-xs text-gray-500">@{account.username}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Step 3: Select Product (after account, so we know whose showcase to load) */}
                {currentStep === 3 && (
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-white">选择橱窗商品</h2>
                        <p className="text-sm text-gray-500">
                            从您的 TikTok Shop 橱窗中选择一个商品（每个视频只能关联一个商品）
                        </p>

                        {selectedAccountId ? (
                            <ShopProductSelector
                                accountId={selectedAccountId}
                                selectedProductId={selectedProduct?.id}
                                onSelect={(product) => setSelectedProduct(product as SelectedProduct | null)}
                            />
                        ) : (
                            <div className="text-center py-12">
                                <Store className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                                <p className="text-sm text-gray-500 mb-4">
                                    请先在上一步选择 Shop 账号
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentStep(2)}
                                >
                                    返回选择账号
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {/* Step 4: Publish Settings */}
                {currentStep === 4 && (
                    <ShopPublishSettings
                        value={publishSettings}
                        onChange={(v) => {
                            setPublishSettings(v);
                            setSettingsErrors({});
                        }}
                        errors={settingsErrors}
                    />
                )}

                {/* Step 5: Review & Submit */}
                {currentStep === 5 && (
                    <div className="space-y-6">
                        <h2 className="text-lg font-semibold text-white">确认发布</h2>
                        <p className="text-sm text-gray-500">
                            请确认以下信息无误后提交发布任务
                        </p>

                        {/* Review Cards */}
                        <div className="space-y-3">
                            {/* Video */}
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
                                <Video className="w-5 h-5 text-cyan-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-500 mb-0.5">视频</p>
                                    <p className="text-sm text-white truncate">{videoSource?.name || '—'}</p>
                                </div>
                                <Badge variant="outline" className="shrink-0">
                                    {videoSource?.source}
                                </Badge>
                            </div>

                            {/* Product */}
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
                                <Package className="w-5 h-5 text-pink-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-500 mb-0.5">商品</p>
                                    <p className="text-sm text-white truncate">{selectedProduct?.shop.name || '—'}</p>
                                </div>
                            </div>

                            {/* Account */}
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
                                <Store className="w-5 h-5 text-green-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-500 mb-0.5">账号</p>
                                    <p className="text-sm text-white truncate">
                                        {accounts.find(a => a.id === selectedAccountId)?.display_name || '—'}
                                    </p>
                                </div>
                            </div>

                            {/* Title */}
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
                                <Settings className="w-5 h-5 text-amber-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-gray-500 mb-0.5">标题</p>
                                    <p className="text-sm text-white">{publishSettings.title || '—'}</p>
                                    {publishSettings.product_anchor_title && (
                                        <p className="text-xs text-gray-500 mt-1">
                                            锚点文案: {publishSettings.product_anchor_title}
                                        </p>
                                    )}
                                </div>
                                {publishSettings.enable_precheck && (
                                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30 shrink-0">
                                        预检 ON
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between">
                <Button
                    variant="outline"
                    onClick={goPrev}
                    disabled={currentStep === 1}
                    className="gap-2"
                >
                    <ChevronLeft className="w-4 h-4" />
                    上一步
                </Button>

                {currentStep < 5 ? (
                    <Button
                        onClick={goNext}
                        disabled={!canProceed}
                        className="gap-2 bg-gradient-to-r from-cyan-500 to-pink-500 hover:from-cyan-600 hover:to-pink-600 text-white"
                    >
                        下一步
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                ) : (
                    <Button
                        onClick={handleSubmit}
                        disabled={submitting || !canProceed}
                        className="gap-2 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black font-bold hover:shadow-[0_0_25px_rgba(0,242,234,0.5)]"
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                提交中...
                            </>
                        ) : (
                            <>
                                <Send className="w-4 h-4" />
                                创建发布任务
                            </>
                        )}
                    </Button>
                )}
            </div>

            {/* Separator */}
            <div className="border-t border-white/10" />

            {/* Task History Section */}
            <div>
                <div className="flex items-center gap-4 mb-4">
                    <div className="w-1 h-6 rounded-full bg-gradient-to-b from-[#00F2EA] to-[#EC4899]" />
                    <h2 className="text-lg font-semibold text-white">发布任务历史</h2>
                </div>
                <ShopTaskManager />
            </div>
        </div>
    );
}
