"use client";

// TikTok Shop Shoppable Video Publishing
// 5-step workflow: Select Video → Select Account → Select Product → Settings → Review & Publish
// Bottom section: task history (ShopTaskManager)

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    Video,
    ShoppingBag,
    Users,
    Settings,
    Send,

    ChevronRight,
    Loader2,
    Check,
    AlertCircle,
    Store,
    Play,
    Package,
    RefreshCw,
    Upload,
    Link2,
    X,
    FileVideo,
    ShieldCheck,
    CheckSquare,
    Square,
    ListFilter,
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
import { useLang } from "@/contexts/LangContext";
import SHOP_TEXT, { localizeError, getPlatformNoticeText, type Lang } from "@/components/shop-publish/shop-publish.i18n";

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
    localPreviewUrl?: string;
}

type TabType = 'create' | 'tasks';

// ============================================================
// Step Configuration
// ============================================================

function getSteps(lang: Lang) {
    const S = SHOP_TEXT.steps;
    return [
        { id: 1, label: S.selectVideo[lang], icon: Video },
        { id: 2, label: S.selectAccount[lang], icon: Users },
        { id: 3, label: S.selectProduct[lang], icon: ShoppingBag },
        { id: 4, label: S.settings[lang], icon: Settings },
        { id: 5, label: S.reviewPublish[lang], icon: Send },
    ] as const;
}

// Accepted video formats
const ACCEPTED_VIDEO_TYPES = "video/mp4,video/webm,video/quicktime";
const MAX_FILE_SIZE_MB = 500;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

// ============================================================
// Page Component
// ============================================================

export default function ShopPublishPage() {
    const { toast } = useToast();
    const router = useRouter();
    const { lang } = useLang();
    const STEPS = getSteps(lang);
    const [activeTab, setActiveTab] = useState<TabType>('create');
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

    // Account list for step 2
    const [accounts, setAccounts] = useState<ShopAccount[]>([]);
    const [accountsLoading, setAccountsLoading] = useState(false);

    // Validation errors
    const [settingsErrors, setSettingsErrors] = useState<Partial<Record<keyof ShopPublishSettingsData, string>>>({});

    // Step 1: Video upload state
    const [videoInputMode, setVideoInputMode] = useState<'upload' | 'url'>('upload');
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Step 5: AI Notice confirmation
    const [confirmed, setConfirmed] = useState(false);

    // ============================================================
    // Fetch Accounts
    // ============================================================

    const fetchAccounts = useCallback(async () => {
        setAccountsLoading(true);
        try {
            const res = await fetch('/api/shop-publish/accounts');
            if (!res.ok) throw new Error('Failed to load accounts');
            const data = await res.json();
            setAccounts(data.accounts || []);
        } catch (error) {
            console.error('Failed to fetch Shop accounts:', error);
            toast({
                variant: 'destructive',
                title: SHOP_TEXT.toast.loadFailed[lang],
                description: SHOP_TEXT.toast.loadFailedDesc[lang],
            });
        } finally {
            setAccountsLoading(false);
        }
    }, [toast, lang]);

    useEffect(() => {
        fetchAccounts();
    }, [fetchAccounts]);

    // ============================================================
    // Reset confirmation when key content changes
    // ============================================================

    useEffect(() => {
        setConfirmed(false);
    }, [videoSource, selectedProduct, selectedAccountId, publishSettings.title, publishSettings.product_anchor_title, publishSettings.enable_precheck]);

    // ============================================================
    // Step Validation
    // ============================================================

    const isStepComplete = (step: number): boolean => {
        switch (step) {
            case 1: return !!videoSource && !uploading && !!videoSource.url;
            case 2: return !!selectedAccountId;
            case 3: return !!selectedProduct;
            case 4: return !!publishSettings.title.trim();
            case 5: return [1, 2, 3, 4].every(s => isStepComplete(s));
            default: return false;
        }
    };

    const canProceed = isStepComplete(currentStep);

    const validateSettings = (): boolean => {
        const errors: Partial<Record<keyof ShopPublishSettingsData, string>> = {};
        const V = SHOP_TEXT.validation;

        if (!publishSettings.title.trim()) {
            errors.title = V.titleRequired[lang];
        } else if (publishSettings.title.length > 150) {
            errors.title = V.titleMaxLen[lang];
        }

        if (publishSettings.product_anchor_title.length > 40) {
            errors.product_anchor_title = V.anchorMaxLen[lang];
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


    // ============================================================
    // Video Upload (A1)
    // ============================================================

    const handleFileSelect = async (file: File) => {
        // Validate type
        const validTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
        if (!validTypes.includes(file.type)) {
            toast({
                variant: 'destructive',
                title: SHOP_TEXT.toast.unsupportedFmt[lang],
                description: SHOP_TEXT.toast.unsupportedDesc[lang],
            });
            return;
        }

        // Validate size
        if (file.size > MAX_FILE_SIZE) {
            toast({
                variant: 'destructive',
                title: SHOP_TEXT.toast.fileTooLarge[lang],
                description: `${lang === 'en' ? 'Maximum file size is' : '\u6700\u5927\u6587\u4ef6\u5927\u5c0f\u4e3a'} ${MAX_FILE_SIZE_MB}MB`,
            });
            return;
        }

        // Create local preview
        const localPreviewUrl = URL.createObjectURL(file);

        // Set preliminary video source for preview
        setVideoSource({
            url: '', // Will be filled after upload
            source: 'upload',
            name: file.name,
            localPreviewUrl,
        });

        // Upload to server
        setUploading(true);
        setUploadProgress(10);

        try {
            const formData = new FormData();
            formData.append('file', file);

            setUploadProgress(30);

            const res = await fetch('/api/upload/video', {
                method: 'POST',
                body: formData,
            });

            setUploadProgress(80);

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Upload failed');
            }

            const data = await res.json();
            setUploadProgress(100);

            // Update with server URL
            setVideoSource({
                url: data.url,
                source: 'upload',
                name: file.name,
                localPreviewUrl,
            });

            toast({
                title: SHOP_TEXT.toast.uploadOk[lang],
                description: SHOP_TEXT.toast.uploadOkDesc[lang],
            });
        } catch (error) {
            console.error('Upload failed:', error);
            toast({
                variant: 'destructive',
                title: SHOP_TEXT.toast.uploadFailed[lang],
                description: error instanceof Error ? localizeError(error.message, lang) : SHOP_TEXT.toast.tryAgain[lang],
            });
            // Clear video source on failure
            setVideoSource(null);
            URL.revokeObjectURL(localPreviewUrl);
        } finally {
            setUploading(false);
            setUploadProgress(0);
        }
    };

    const handleClearVideo = () => {
        if (videoSource?.localPreviewUrl) {
            URL.revokeObjectURL(videoSource.localPreviewUrl);
        }
        setVideoSource(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // ============================================================
    // Submit (A0.2: auto-trigger process after task creation)
    // ============================================================

    const handleSubmit = async () => {
        if (!videoSource || !videoSource.url || !selectedProduct || !selectedAccountId || !publishSettings.title.trim()) {
            toast({
                variant: 'destructive',
                title: SHOP_TEXT.toast.incomplete[lang],
                description: uploading ? SHOP_TEXT.toast.waitUpload[lang] : SHOP_TEXT.toast.incompleteDesc[lang],
            });
            return;
        }

        if (!confirmed) {
            toast({
                variant: 'destructive',
                title: SHOP_TEXT.toast.confirmRequired[lang],
                description: SHOP_TEXT.toast.confirmDesc[lang],
            });
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch('/api/shop-publish/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_name: `Shop Publish — ${publishSettings.title.substring(0, 30)}`,
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
                throw new Error(data.error || 'Failed to create task');
            }

            // A0.2: Fire-and-forget call to process route to start task execution
            fetch('/api/shop-publish/process', { method: 'POST' }).catch(err => {
                console.warn('[ShopPublish] Background process trigger failed (non-blocking):', err);
            });

            toast({
                title: SHOP_TEXT.toast.taskCreated[lang],
                description: SHOP_TEXT.toast.taskCreatedDesc[lang],
            });

            // Reset form
            handleClearVideo();
            setSelectedProduct(null);
            setSelectedAccountId(null);
            setPublishSettings({
                title: '',
                product_anchor_title: '',
                enable_precheck: false,
            });
            setConfirmed(false);
            setCurrentStep(1);
            setActiveTab('tasks');
        } catch (error) {
            console.error('Failed to create task:', error);
            toast({
                variant: 'destructive',
                title: SHOP_TEXT.toast.createFailed[lang],
                description: error instanceof Error ? localizeError(error.message, lang) : SHOP_TEXT.toast.taskFailed[lang],
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
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-1.5 h-14 rounded-full bg-gradient-to-b from-[#CCFF00] via-[#00F2EA] to-[#EC4899]" />
                    <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <ShoppingBag className="h-6 w-6" />
                        {SHOP_TEXT.page.title[lang]}
                    </h1>
                    <p className="text-white/50 text-sm mt-0.5">
                        {SHOP_TEXT.page.subtitle[lang]}
                    </p>
                    </div>
                </div>
                <button
                    onClick={() => router.push('/shop-publish/accounts')}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all"
                >
                    <Settings className="w-4 h-4 text-white/70" />
                    <span className="text-white/80">{lang === 'en' ? 'Accounts' : '账号管理'}</span>
                </button>
            </div>
            {/* Tabs */}
            <div className="flex gap-1 p-1.5 bg-black/40 rounded-xl border border-white/10 w-fit backdrop-blur-md">
                {[
                    { id: 'create' as TabType, label: lang === 'en' ? 'Create' : '创建发布', icon: Send },
                    { id: 'tasks' as TabType, label: lang === 'en' ? 'Tasks' : '任务管理', icon: ListFilter },
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`group relative flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all duration-300 overflow-hidden ${activeTab === tab.id
                            ? 'bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black shadow-[0_0_20px_rgba(0,242,234,0.4)]'
                            : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                            }`}
                    >
                        {activeTab === tab.id && (
                            <>
                                <div className="absolute inset-0 bg-gradient-to-b from-white/50 via-white/20 to-transparent pointer-events-none" />
                                <div className="absolute top-[10%] left-0 right-0 h-[40%] bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-lg" />
                            </>
                        )}
                        <tab.icon className={`w-4 h-4 relative z-10 ${activeTab === tab.id ? 'text-black' : ''}`} />
                        <span className="relative z-10">{tab.label}</span>
                    </button>
                ))}
            </div>

            {activeTab === 'create' && (
            <div className="space-y-3">
                {STEPS.map((step) => {
                    const Icon = step.icon;
                    const stepNum = step.id;
                    const isActive = currentStep === stepNum;
                    const isCompleted = isStepComplete(stepNum) && !isActive;
                    const isLocked = !isCompleted && (stepNum > currentStep + 1 || (stepNum === currentStep + 1 && !canProceed));
                    const canOpen = isCompleted || stepNum <= currentStep || (stepNum === currentStep + 1 && canProceed);

                    return (
                        <div
                            key={stepNum}
                            className={cn(
                                'rounded-2xl border overflow-hidden transition-all duration-300',
                                isActive
                                    ? 'border-cyan-500/30 bg-white/5 shadow-[0_0_20px_rgba(0,242,234,0.08)]'
                                    : isCompleted
                                        ? 'border-green-500/20 bg-white/[0.03]'
                                        : isLocked
                                            ? 'border-white/5 bg-white/[0.02] opacity-50'
                                            : 'border-white/10 bg-white/[0.03]'
                            )}
                        >
                            {/* Section Header */}
                            <button
                                onClick={() => {
                                    if (!canOpen || isActive) return;
                                    if (stepNum === 5 && currentStep === 4 && !validateSettings()) return;
                                    setCurrentStep(stepNum);
                                }}
                                disabled={isLocked}
                                className={cn(
                                    'w-full flex items-center gap-4 px-5 py-4 text-left transition-all',
                                    canOpen && !isActive ? 'cursor-pointer hover:bg-white/5' : '',
                                    isLocked ? 'cursor-not-allowed' : ''
                                )}
                            >
                                <div className={cn(
                                    'w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold transition-all',
                                    isActive
                                        ? 'bg-gradient-to-br from-cyan-500 to-pink-500 text-white shadow-lg shadow-cyan-500/20'
                                        : isCompleted
                                            ? 'bg-green-500 text-white'
                                            : 'bg-white/10 text-gray-500'
                                )}>
                                    {isCompleted ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <span className={cn(
                                        'text-sm font-semibold',
                                        isActive ? 'text-white' : isCompleted ? 'text-green-300' : 'text-gray-500'
                                    )}>
                                        {step.label}
                                    </span>
                                    {isCompleted && !isActive && (
                                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                                            {stepNum === 1 && videoSource?.name}
                                            {stepNum === 2 && accounts.find(a => a.id === selectedAccountId)?.display_name}
                                            {stepNum === 3 && selectedProduct?.shop?.name}
                                            {stepNum === 4 && (
                                                <>{publishSettings.title.substring(0, 30)}{publishSettings.title.length > 30 ? '...' : ''}{publishSettings.enable_precheck ? ` · ${SHOP_TEXT.review.precheckOn[lang]}` : ''}</>
                                            )}
                                        </p>
                                    )}
                                </div>

                                {isCompleted && !isActive && (
                                    <Badge variant="outline" className="text-green-400 border-green-500/30 shrink-0 text-[10px]">
                                        <Check className="w-3 h-3 mr-1" />
                                        {lang === 'en' ? 'Done' : '\u5df2\u5b8c\u6210'}
                                    </Badge>
                                )}
                                {isActive && (
                                    <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30 shrink-0 text-[10px]">
                                        {lang === 'en' ? 'Current' : '\u5f53\u524d'}
                                    </Badge>
                                )}
                            </button>

                            {/* Section Content */}
                            {isActive && (
                                <div className="px-5 pb-5 pt-1 border-t border-white/5">
                                    {/* Step 1: Video */}
                                    {stepNum === 1 && (
                                        <div className="space-y-4">
                                            <p className="text-sm text-gray-500">{SHOP_TEXT.video.sectionDesc[lang]}</p>
                                            <div className="flex gap-2">
                                                <button onClick={() => setVideoInputMode('upload')} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all', videoInputMode === 'upload' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10')}>
                                                    <Upload className="w-4 h-4" />{SHOP_TEXT.video.uploadTab[lang]}
                                                </button>
                                                <button onClick={() => setVideoInputMode('url')} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all', videoInputMode === 'url' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10')}>
                                                    <Link2 className="w-4 h-4" />{SHOP_TEXT.video.urlTab[lang]}
                                                </button>
                                            </div>
                                            {videoInputMode === 'upload' && (
                                                <div className="space-y-3">
                                                    {!videoSource ? (
                                                        <label className={cn('flex flex-col items-center justify-center py-12 rounded-xl border-2 border-dashed transition-all cursor-pointer', uploading ? 'border-cyan-500/50 bg-cyan-500/5' : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/5')}>
                                                            <input ref={fileInputRef} type="file" accept={ACCEPTED_VIDEO_TYPES} className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileSelect(file); }} disabled={uploading} />
                                                            {uploading ? (<><Loader2 className="w-10 h-10 text-cyan-400 animate-spin mb-3" /><p className="text-sm text-cyan-300 font-medium">{SHOP_TEXT.video.uploading[lang]} {uploadProgress}%</p><div className="w-48 h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden"><div className="h-full bg-gradient-to-r from-cyan-500 to-pink-500 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} /></div></>) : (<><Upload className="w-10 h-10 text-gray-500 mb-3" /><p className="text-sm text-gray-400 font-medium">{SHOP_TEXT.video.dropzoneTitle[lang]}</p><p className="text-xs text-gray-600 mt-1">{SHOP_TEXT.video.dropzoneFormats[lang]} — {SHOP_TEXT.video.maxSize[lang]}</p></>)}
                                                        </label>
                                                    ) : (
                                                        <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                                                            {videoSource.localPreviewUrl ? (<div className="relative aspect-video bg-black max-h-[300px]"><video src={videoSource.localPreviewUrl} className="w-full h-full object-contain" controls muted /></div>) : (<div className="flex items-center justify-center py-8 bg-white/[0.02]"><FileVideo className="w-12 h-12 text-gray-600" /></div>)}
                                                            <div className="flex items-center gap-3 p-3 border-t border-white/5">
                                                                <Play className="w-5 h-5 text-green-400 shrink-0" />
                                                                <div className="flex-1 min-w-0"><p className="text-sm text-white truncate">{videoSource.name}</p></div>
                                                                {!uploading && videoSource.url && (<Badge variant="outline" className="text-green-400 border-green-500/30 shrink-0">{SHOP_TEXT.video.videoReady[lang]}</Badge>)}
                                                                {uploading && (<Badge variant="outline" className="text-cyan-400 border-cyan-500/30 shrink-0 animate-pulse">{SHOP_TEXT.video.uploading[lang]}</Badge>)}
                                                                <button onClick={handleClearVideo} disabled={uploading} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-red-400 transition-all disabled:opacity-50"><X className="w-4 h-4" /></button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {videoInputMode === 'url' && (
                                                <div className="space-y-3">
                                                    <div className="relative">
                                                        <Video className="absolute left-3 top-3 h-5 w-5 text-gray-500" />
                                                        <input type="url" value={videoSource?.source === 'url' ? videoSource.url : ''} onChange={(e) => { const url = e.target.value; if (url) { setVideoSource({ url, source: 'url', name: url.split('/').pop() || 'video' }); } else { setVideoSource(null); } }} placeholder={SHOP_TEXT.video.urlPlaceholder[lang]} className="w-full h-12 pl-11 pr-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50" />
                                                    </div>
                                                    {videoSource && videoSource.source === 'url' && (
                                                        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                                                            <Play className="w-5 h-5 text-green-400" /><div className="flex-1 min-w-0"><p className="text-sm text-green-300 truncate">{videoSource.name}</p></div>
                                                            <Badge variant="outline" className="text-green-400 border-green-500/30">{SHOP_TEXT.video.videoReady[lang]}</Badge>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {canProceed && (<div className="flex justify-end pt-2"><Button onClick={goNext} className="gap-2 bg-gradient-to-r from-cyan-500 to-pink-500 hover:from-cyan-600 hover:to-pink-600 text-white">{SHOP_TEXT.nav.continue[lang]}<ChevronRight className="w-4 h-4" /></Button></div>)}
                                        </div>
                                    )}

                                    {/* Step 2: Account */}
                                    {stepNum === 2 && (
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <p className="text-sm text-gray-500">{lang === 'en' ? 'Choose a Shop account to publish the video' : '\u9009\u62e9\u4e00\u4e2a Shop \u8d26\u53f7\u53d1\u5e03\u89c6\u9891'}</p>
                                                <Button variant="ghost" size="sm" onClick={fetchAccounts} className="text-gray-400 hover:text-white"><RefreshCw className={cn('w-4 h-4', accountsLoading && 'animate-spin')} /></Button>
                                            </div>
                                            {accountsLoading ? (
                                                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
                                            ) : accounts.length === 0 ? (
                                                <div className="text-center py-12">
                                                    <Store className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                                                    <p className="text-sm text-gray-500 mb-4">{SHOP_TEXT.account.noAccounts[lang]}</p>
                                                    <Button variant="outline" size="sm" onClick={() => router.push('/shop-publish/accounts')}>{SHOP_TEXT.account.manageAccounts[lang]}</Button>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-2 gap-3">
                                                    {accounts.map(account => {
                                                        const isValid = isAccountTokenValid(account);
                                                        const isSelected = selectedAccountId === account.id;
                                                        return (
                                                            <div key={account.id} onClick={() => { if (!isValid) return; const newId = isSelected ? null : account.id; setSelectedAccountId(newId); if (newId !== selectedAccountId) setSelectedProduct(null); }} className={cn('relative p-3 rounded-xl border transition-all cursor-pointer', isSelected ? 'bg-cyan-500/10 border-cyan-500/50' : 'bg-white/5 border-white/10 hover:border-white/20', !isValid && 'opacity-50 cursor-not-allowed')}>
                                                                <div className="flex items-center gap-3">
                                                                    <div className="relative">
                                                                        {account.avatar_url ? (<img src={account.avatar_url} alt={account.display_name || 'Shop'} className="w-10 h-10 rounded-full object-cover" />) : (<div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#00F2EA] to-[#EC4899] flex items-center justify-center text-white font-bold">{(account.display_name || 'S').charAt(0)}</div>)}
                                                                        {isSelected && (<div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center"><Check className="w-3 h-3 text-white" /></div>)}
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="font-medium text-white truncate">{account.display_name || 'Shop Account'}</span>
                                                                            {!isValid && (<span className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{SHOP_TEXT.account.tokenExpired[lang]}</span>)}
                                                                        </div>
                                                                        {account.username && (<p className="text-xs text-gray-500">@{account.username}</p>)}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            {canProceed && (<div className="flex justify-end pt-2"><Button onClick={goNext} className="gap-2 bg-gradient-to-r from-cyan-500 to-pink-500 hover:from-cyan-600 hover:to-pink-600 text-white">{SHOP_TEXT.nav.continue[lang]}<ChevronRight className="w-4 h-4" /></Button></div>)}
                                        </div>
                                    )}

                                    {/* Step 3: Product */}
                                    {stepNum === 3 && (
                                        <div className="space-y-4">
                                            <p className="text-sm text-gray-500">{lang === 'en' ? 'Choose a product from your showcase (one per video)' : '\u4ece\u6a71\u7a97\u9009\u62e9\u5546\u54c1\uff08\u6bcf\u89c6\u9891\u4e00\u4e2a\uff09'}</p>
                                            {selectedAccountId ? (
                                                <ShopProductSelector accountId={selectedAccountId} selectedProductId={selectedProduct?.id} onSelect={(product) => setSelectedProduct(product as SelectedProduct | null)} />
                                            ) : (
                                                <div className="text-center py-12">
                                                    <Store className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                                                    <p className="text-sm text-gray-500 mb-4">{lang === 'en' ? 'Please select a Shop account first' : '\u8bf7\u5148\u9009\u62e9 Shop \u8d26\u53f7'}</p>
                                                    <Button variant="outline" size="sm" onClick={() => setCurrentStep(2)}>{lang === 'en' ? 'Back to Account Selection' : '\u8fd4\u56de\u9009\u62e9\u8d26\u53f7'}</Button>
                                                </div>
                                            )}
                                            {canProceed && (<div className="flex justify-end pt-2"><Button onClick={goNext} className="gap-2 bg-gradient-to-r from-cyan-500 to-pink-500 hover:from-cyan-600 hover:to-pink-600 text-white">{SHOP_TEXT.nav.continue[lang]}<ChevronRight className="w-4 h-4" /></Button></div>)}
                                        </div>
                                    )}

                                    {/* Step 4: Settings */}
                                    {stepNum === 4 && (
                                        <div className="space-y-4 pt-2">
                                            <ShopPublishSettings value={publishSettings} onChange={(v) => { setPublishSettings(v); setSettingsErrors({}); }} errors={settingsErrors} />
                                            {canProceed && (<div className="flex justify-end pt-2"><Button onClick={() => { if (validateSettings()) goNext(); }} className="gap-2 bg-gradient-to-r from-cyan-500 to-pink-500 hover:from-cyan-600 hover:to-pink-600 text-white">{SHOP_TEXT.nav.continue[lang]}<ChevronRight className="w-4 h-4" /></Button></div>)}
                                        </div>
                                    )}

                                    {/* Step 5: Review & Submit */}
                                    {stepNum === 5 && (
                                        <div className="space-y-6 pt-2">
                                            <p className="text-sm text-gray-500">{SHOP_TEXT.review.reviewDesc[lang]}</p>
                                            <div className="space-y-3">
                                                <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
                                                    <Video className="w-5 h-5 text-cyan-400 shrink-0" />
                                                    <div className="flex-1 min-w-0"><p className="text-xs text-gray-500 mb-0.5">{SHOP_TEXT.review.videoLabel[lang]}</p><p className="text-sm text-white truncate">{videoSource?.name || '\u2014'}</p></div>
                                                    <Badge variant="outline" className="shrink-0">{videoSource?.source}</Badge>
                                                </div>
                                                <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
                                                    <Package className="w-5 h-5 text-pink-400 shrink-0" />
                                                    <div className="flex-1 min-w-0"><p className="text-xs text-gray-500 mb-0.5">{SHOP_TEXT.review.productLabel[lang]}</p><p className="text-sm text-white truncate">{selectedProduct?.shop.name || '\u2014'}</p></div>
                                                </div>
                                                <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
                                                    <Store className="w-5 h-5 text-green-400 shrink-0" />
                                                    <div className="flex-1 min-w-0"><p className="text-xs text-gray-500 mb-0.5">{SHOP_TEXT.review.accountLabel[lang]}</p><p className="text-sm text-white truncate">{accounts.find(a => a.id === selectedAccountId)?.display_name || '\u2014'}</p></div>
                                                </div>
                                                <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
                                                    <Settings className="w-5 h-5 text-amber-400 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs text-gray-500 mb-0.5">{SHOP_TEXT.review.titleLabel[lang]}</p>
                                                        <p className="text-sm text-white">{publishSettings.title || '\u2014'}</p>
                                                        {publishSettings.product_anchor_title && (<p className="text-xs text-gray-500 mt-1">{SHOP_TEXT.review.anchorLabel[lang]}: {publishSettings.product_anchor_title}</p>)}
                                                    </div>
                                                    {publishSettings.enable_precheck && (<Badge variant="outline" className="text-green-400 border-green-500/30 shrink-0">{SHOP_TEXT.review.precheckOn[lang]}</Badge>)}
                                                </div>
                                            </div>
                                            {(() => { const notice = getPlatformNoticeText(lang); const guidelines = SHOP_TEXT.review.guidelinesItems[lang]; return (
                                                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                                                    <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-amber-400" /><h3 className="text-sm font-semibold text-amber-300">{SHOP_TEXT.review.platformNotice[lang]}</h3></div>
                                                    <div className="text-xs text-gray-400 space-y-1.5 leading-relaxed">
                                                        <p>{notice.text1}</p><p>{notice.text2}</p>
                                                        <ul className="list-disc list-inside space-y-0.5 ml-1">{guidelines.map((item: string, i: number) => (<li key={i}>{item}</li>))}</ul>
                                                    </div>
                                                    <button onClick={() => setConfirmed(!confirmed)} className="flex items-start gap-2 mt-2 group cursor-pointer w-full text-left">
                                                        {confirmed ? (<CheckSquare className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />) : (<Square className="w-5 h-5 text-gray-500 shrink-0 mt-0.5 group-hover:text-gray-300" />)}
                                                        <span className={cn('text-sm', confirmed ? 'text-green-300' : 'text-gray-400 group-hover:text-gray-300')}>{notice.confirmText}</span>
                                                    </button>
                                                </div>
                                            ); })()}
                                            <div className="flex justify-end pt-2">
                                                <Button onClick={handleSubmit} disabled={submitting || !canProceed || !confirmed} className="gap-2 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black font-bold hover:shadow-[0_0_25px_rgba(0,242,234,0.5)]">
                                                    {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" />{SHOP_TEXT.nav.submitting[lang]}</>) : (<><Send className="w-4 h-4" />{SHOP_TEXT.nav.createTask[lang]}</>)}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            )}

            {activeTab === 'tasks' && (
                <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
                    <ShopTaskManager />
                </div>
            )}
        </div>
    );
}
