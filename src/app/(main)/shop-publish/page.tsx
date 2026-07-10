"use client";

// TikTok Shop Shoppable Video Publishing
// Two-column layout: Left (5 config sections) + Right (Live Preview) + Bottom Action Bar
// Bottom section: task history (ShopTaskManager)

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    Video,
    ShoppingBag,
    Settings,
    Send,
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
    Users,
    Eye,
    RotateCcw,
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
    const [activeTab, setActiveTab] = useState<TabType>('create');
    const [submitting, setSubmitting] = useState(false);

    // Core business state
    const [videoSource, setVideoSource] = useState<VideoSource | null>(null);
    const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [publishSettings, setPublishSettings] = useState<ShopPublishSettingsData>({
        title: '',
        product_anchor_title: '',
        enable_precheck: true,
    });

    // Account list
    const [accounts, setAccounts] = useState<ShopAccount[]>([]);
    const [accountsLoading, setAccountsLoading] = useState(false);

    // Validation errors
    const [settingsErrors, setSettingsErrors] = useState<Partial<Record<keyof ShopPublishSettingsData, string>>>({});

    // Video upload state
    const [videoInputMode, setVideoInputMode] = useState<'upload' | 'url'>('upload');
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Compliance confirmation
    const [confirmed, setConfirmed] = useState(false);

    // Section refs for scroll-to
    const accountSectionRef = useRef<HTMLDivElement>(null);

    // ============================================================
    // Derived: canSubmit (strict server-side alignment)
    // ============================================================

    const canSubmit =
        !!videoSource &&
        !!videoSource.url &&
        !uploading &&
        !!selectedAccountId &&
        !!selectedProduct &&
        !!publishSettings.title.trim() &&
        confirmed;

    // Missing items for action bar hint
    const missingItems = [
        !selectedAccountId ? SHOP_TEXT.review.accountLabel[lang] : null,
        (!videoSource?.url || uploading) ? SHOP_TEXT.review.videoLabel[lang] : null,
        !selectedProduct ? SHOP_TEXT.review.productLabel[lang] : null,
        !publishSettings.title.trim() ? SHOP_TEXT.review.captionLabel[lang] : null,
        !confirmed ? SHOP_TEXT.review.confirmationLabel[lang] : null,
    ].filter(Boolean) as string[];

    const submitHint = missingItems.length
        ? `${SHOP_TEXT.review.completeFirst[lang]}: ${missingItems.join(' / ')}`
        : '';

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
    // Validation
    // ============================================================

    const validateSettings = (): boolean => {
        const errors: Partial<Record<keyof ShopPublishSettingsData, string>> = {};
        const V = SHOP_TEXT.validation;

        if (!publishSettings.title.trim()) {
            errors.title = V.titleRequired[lang];
        } else if (publishSettings.title.length > 150) {
            errors.title = V.titleMaxLen[lang];
        }

        if (publishSettings.product_anchor_title.length > 30) {
            errors.product_anchor_title = V.anchorMaxLen[lang];
        }

        setSettingsErrors(errors);
        return Object.keys(errors).length === 0;
    };

    // ============================================================
    // Video Upload
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
    // Submit
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

        if (!validateSettings()) return;

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

            // Fire-and-forget call to process route
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
                enable_precheck: true,
            });
            setConfirmed(false);
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
    // Helpers
    // ============================================================

    const selectedAccount = accounts.find(a => a.id === selectedAccountId);
    const previewVideoSrc = videoSource?.localPreviewUrl ?? videoSource?.url;
    // Anchor text fallback aligned with backend: product_anchor_title || publishSettings.title
    const previewAnchorText = publishSettings.product_anchor_title || publishSettings.title;
    const notice = getPlatformNoticeText(lang);
    const guidelines = SHOP_TEXT.review.guidelinesItems[lang];

    const handleReset = () => {
        handleClearVideo();
        setSelectedProduct(null);
        setSelectedAccountId(null);
        setPublishSettings({ title: '', product_anchor_title: '', enable_precheck: true });
        setConfirmed(false);
    };

    // ============================================================
    // Render
    // ============================================================

    return (
        <div className="space-y-6">
            {/* ============================================================ */}
            {/* Page Header */}
            {/* ============================================================ */}
            <div className="flex items-center justify-between gap-4 bg-white/[0.02] border border-white/5 p-4 rounded-2xl">
                <div className="flex items-center gap-4">
                    <div className="w-1 h-10 rounded-full bg-gradient-to-b from-[#CCFF00] via-[#00F2EA] to-[#EC4899] opacity-80" />
                    <div>
                    <h1 className="text-xl font-bold text-white flex items-center gap-2">
                        <ShoppingBag className="h-5 w-5" />
                        {SHOP_TEXT.page.title[lang]}
                    </h1>
                    <p className="text-white/50 text-xs mt-1">
                        {SHOP_TEXT.page.subtitle[lang]}
                    </p>
                    </div>
                </div>
                <button
                    onClick={() => router.push('/shop-publish/accounts')}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all text-sm shadow-sm font-medium"
                >
                    <Settings className="w-4 h-4 text-white/70" />
                    <span className="text-white/80">{SHOP_TEXT.account.manageAccounts[lang]}</span>
                </button>
            </div>

            {/* ============================================================ */}
            {/* Tabs */}
            {/* ============================================================ */}
            <div className="flex gap-2 p-1.5 bg-white/[0.03] rounded-2xl border border-white/10 w-fit backdrop-blur-md">
                {[
                    { id: 'create' as TabType, label: SHOP_TEXT.page.tabCreate[lang], icon: Send },
                    { id: 'tasks' as TabType, label: SHOP_TEXT.page.tabTasks[lang], icon: ListFilter },
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`group relative flex items-center gap-2 px-6 py-2.5 rounded-xl transition-all duration-300 ${activeTab === tab.id
                            ? 'bg-white/10 text-white shadow-lg border border-white/10'
                            : 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent'
                            }`}
                    >
                        {activeTab === tab.id && (
                            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#CCFF00]/10 via-[#00F2EA]/10 to-[#EC4899]/10 pointer-events-none" />
                        )}
                        <tab.icon className={`w-4 h-4 relative z-10 transition-colors ${activeTab === tab.id ? 'text-[#00F2EA]' : 'text-white/40 group-hover:text-white/80'}`} />
                        <span className="relative z-10 text-sm font-medium">{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* ============================================================ */}
            {/* CREATE TAB — Two-Column Layout */}
            {/* ============================================================ */}
            {activeTab === 'create' && (
            <div className="flex flex-col lg:flex-row gap-6 items-start relative">

                {/* ============================================================ */}
                {/* LEFT COLUMN: 5-Section Form + Action Bar */}
                {/* ============================================================ */}
                <div className="flex-1 min-w-0 flex flex-col space-y-5">

                    {/* ======== SECTION A: 发布账号 ======== */}
                    <div ref={accountSectionRef} className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500/20 to-pink-500/20 flex items-center justify-center">
                                <Users className="w-4 h-4 text-cyan-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-semibold text-white">{SHOP_TEXT.steps.selectAccount[lang]}</h3>
                                <p className="text-xs text-gray-500">{SHOP_TEXT.account.sectionDesc[lang]}</p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={fetchAccounts} className="text-gray-400 hover:text-white shrink-0">
                                <RefreshCw className={cn('w-4 h-4', accountsLoading && 'animate-spin')} />
                            </Button>
                        </div>
                        <div className="p-5">
                            {accountsLoading ? (
                                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
                            ) : accounts.length === 0 ? (
                                <div className="text-center py-8">
                                    <Store className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                                    <p className="text-sm text-gray-500 mb-4">{SHOP_TEXT.account.noAccounts[lang]}</p>
                                    <Button variant="outline" size="sm" onClick={() => router.push('/shop-publish/accounts')}>{SHOP_TEXT.account.manageAccounts[lang]}</Button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {accounts.map(account => {
                                        const isValid = isAccountTokenValid(account);
                                        const isSelected = selectedAccountId === account.id;
                                        return (
                                            <div key={account.id} onClick={() => { if (!isValid) return; const newId = isSelected ? null : account.id; setSelectedAccountId(newId); if (newId !== selectedAccountId) setSelectedProduct(null); }} className={cn('relative p-3 rounded-xl border transition-all cursor-pointer', isSelected ? 'bg-cyan-500/10 border-cyan-500/50 shadow-[0_0_15px_rgba(0,242,234,0.08)]' : 'bg-white/[0.03] border-white/10 hover:border-white/20 hover:bg-white/[0.06]', !isValid && 'opacity-50 cursor-not-allowed')}>
                                                <div className="flex items-center gap-3">
                                                    <div className="relative">
                                                        {account.avatar_url ? (<img src={account.avatar_url} alt={account.display_name || 'Shop'} className="w-10 h-10 rounded-full object-cover" />) : (<div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#00F2EA] to-[#EC4899] flex items-center justify-center text-white font-bold">{(account.display_name || 'S').charAt(0)}</div>)}
                                                        {isSelected && (<div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center"><Check className="w-3 h-3 text-white" /></div>)}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-white text-sm truncate">{account.display_name || 'Shop Account'}</span>
                                                            {!isValid && (<span className="text-xs text-red-400 flex items-center gap-1 shrink-0"><AlertCircle className="w-3 h-3" />{SHOP_TEXT.account.tokenExpired[lang]}</span>)}
                                                        </div>
                                                        {account.username && (<p className="text-xs text-gray-500">@{account.username}</p>)}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ======== SECTION B: 视频素材 ======== */}
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500/20 to-pink-500/20 flex items-center justify-center">
                                <Video className="w-4 h-4 text-cyan-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-semibold text-white">{SHOP_TEXT.video.sectionTitle[lang]}</h3>
                                <p className="text-xs text-gray-500">{SHOP_TEXT.video.sectionDesc[lang]}</p>
                            </div>
                        </div>
                        <div className="p-5 space-y-4">
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
                                            <Badge variant="outline" className="text-amber-400 border-amber-500/30">{SHOP_TEXT.video.urlEntered[lang]}</Badge>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ======== SECTION C: 挂载商品 ======== */}
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500/20 to-pink-500/20 flex items-center justify-center">
                                <Package className="w-4 h-4 text-pink-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-semibold text-white">{SHOP_TEXT.steps.selectProduct[lang]}</h3>
                                <p className="text-xs text-gray-500">{SHOP_TEXT.review.singleProductHint[lang]}</p>
                            </div>
                        </div>
                        <div className="p-5">
                            {selectedAccountId ? (
                                <div className="space-y-4">
                                    {/* Selected product card */}
                                    {selectedProduct && (
                                        <div className="flex gap-4 p-4 rounded-xl border border-cyan-500/30 bg-cyan-500/5">
                                            {selectedProduct.addition?.customized_main_images?.[0]?.url && (
                                                <img src={selectedProduct.addition.customized_main_images[0].url} alt="Product" className="w-16 h-16 rounded-lg object-cover shrink-0" />
                                            )}
                                            <div className="flex-1 min-w-0 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">{SHOP_TEXT.product.shopLabel[lang]}</span>
                                                    <span className="text-sm text-white font-medium truncate">{selectedProduct.shop.name}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">{SHOP_TEXT.product.productIdLabel[lang]}</span>
                                                    <span className="text-xs text-gray-400 font-mono">{selectedProduct.id.substring(0, 16)}...</span>
                                                </div>
                                                <div className="flex items-center gap-3 pt-1">
                                                    {selectedProduct.price?.original_price?.minimum_amount && (() => {
                                                        const min = selectedProduct.price.original_price.minimum_amount;
                                                        const max = selectedProduct.price.original_price.maximum_amount;
                                                        const formatted = min === max
                                                            ? `$${(parseInt(min) / 100).toFixed(2)}`
                                                            : `$${(parseInt(min) / 100).toFixed(2)} - $${(parseInt(max) / 100).toFixed(2)}`;
                                                        return <span className="text-sm font-semibold text-[#CCFF00]">{formatted}</span>;
                                                    })()}
                                                    {selectedProduct.commission_rate != null && selectedProduct.commission_rate > 0 && (
                                                        <Badge variant="outline" className="text-amber-400 border-amber-500/30 text-[10px]">{SHOP_TEXT.product.comm[lang]} {(selectedProduct.commission_rate * 100).toFixed(1)}%</Badge>
                                                    )}
                                                </div>
                                            </div>
                                            <button onClick={() => setSelectedProduct(null)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-red-400 transition-all self-start shrink-0"><X className="w-4 h-4" /></button>
                                        </div>
                                    )}
                                    <ShopProductSelector accountId={selectedAccountId} selectedProductId={selectedProduct?.id} onSelect={(product) => setSelectedProduct(product as SelectedProduct | null)} />
                                </div>
                            ) : (
                                <div className="text-center py-8">
                                    <Store className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                                    <p className="text-sm text-gray-500 mb-4">{SHOP_TEXT.account.selectFirst[lang]}</p>
                                    <Button variant="outline" size="sm" onClick={() => accountSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{SHOP_TEXT.account.goSelectAccount[lang]}</Button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ======== SECTION D: 文案与发布设置 ======== */}
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500/20 to-pink-500/20 flex items-center justify-center">
                                <Settings className="w-4 h-4 text-amber-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-semibold text-white">{SHOP_TEXT.settings.sectionTitle[lang]}</h3>
                                <p className="text-xs text-gray-500">{SHOP_TEXT.settings.sectionDesc[lang]}</p>
                            </div>
                        </div>
                        <div className="p-5">
                            <ShopPublishSettings value={publishSettings} onChange={(v) => { setPublishSettings(v); setSettingsErrors({}); }} errors={settingsErrors} />
                        </div>
                    </div>

                    {/* ======== SECTION E: 合规确认 ======== */}
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
                        <div className="flex items-center gap-3 px-5 py-4 border-b border-amber-500/10">
                            <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                                <ShieldCheck className="w-4 h-4 text-amber-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-semibold text-amber-300">{SHOP_TEXT.review.platformNotice[lang]}</h3>
                            </div>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="text-xs text-gray-400 space-y-1.5 leading-relaxed">
                                <p>{notice.text1}</p>
                                <p>{notice.text2}</p>
                                <ul className="list-disc list-inside space-y-0.5 ml-1">{guidelines.map((item: string, i: number) => (<li key={i}>{item}</li>))}</ul>
                            </div>
                            <button onClick={() => setConfirmed(!confirmed)} className="flex items-start gap-3 mt-2 group cursor-pointer w-full text-left p-3 rounded-xl border border-white/5 hover:border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-all">
                                {confirmed ? (<CheckSquare className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />) : (<Square className="w-5 h-5 text-gray-500 shrink-0 mt-0.5 group-hover:text-gray-300" />)}
                                <span className={cn('text-sm', confirmed ? 'text-green-300' : 'text-gray-400 group-hover:text-gray-300')}>{notice.confirmText}</span>
                            </button>
                            <p className="text-[11px] text-gray-600 leading-relaxed">{notice.disclaimer}</p>
                        </div>
                    </div>

                    {/* ============================================================ */}
                    {/* Mobile Preview (shown before action bar on small screens) */}
                    {/* ============================================================ */}
                    <div className="lg:hidden">
                        <MobilePreview
                            lang={lang}
                            previewVideoSrc={previewVideoSrc}
                            selectedAccount={selectedAccount}
                            publishSettings={publishSettings}
                            selectedProduct={selectedProduct}
                            previewAnchorText={previewAnchorText}
                        />
                    </div>

                    {/* ============================================================ */}
                    {/* STICKY ACTION BAR */}
                    {/* ============================================================ */}
                    <div className="sticky bottom-4 z-40 rounded-2xl border border-white/10 bg-gray-950/95 backdrop-blur-xl p-4 shadow-2xl shadow-black/50">
                        {/* Status badges */}
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                            <StatusBadge ok={!!selectedAccountId} label={SHOP_TEXT.review.accountLabel[lang]} />
                            <StatusBadge ok={!!videoSource?.url && !uploading} label={SHOP_TEXT.review.videoLabel[lang]} />
                            <StatusBadge ok={!!selectedProduct} label={SHOP_TEXT.review.productLabel[lang]} />
                            <StatusBadge ok={!!publishSettings.title.trim()} label={SHOP_TEXT.review.captionLabel[lang]} />
                            <StatusBadge ok={confirmed} label={SHOP_TEXT.review.confirmationLabel[lang]} />
                        </div>
                        {/* Hint + buttons */}
                        <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                                {submitHint && (
                                    <p className="text-xs text-red-400/80 line-clamp-2 leading-relaxed">{submitHint}</p>
                                )}
                            </div>
                            <Button variant="outline" size="sm" onClick={handleReset} className="text-gray-400 border-white/10 hover:text-white shrink-0">
                                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />{SHOP_TEXT.page.resetBtn[lang]}
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={!canSubmit || submitting}
                                className="gap-2 bg-gradient-to-r from-[#CCFF00] via-[#00F2EA] to-[#EC4899] text-black font-bold hover:shadow-[0_0_25px_rgba(0,242,234,0.5)] disabled:opacity-40 disabled:shadow-none shrink-0"
                            >
                                {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" />{SHOP_TEXT.nav.submitting[lang]}</>) : (<><Send className="w-4 h-4" />{SHOP_TEXT.nav.createTask[lang]}</>)}
                            </Button>
                        </div>
                    </div>

                </div>

                {/* ============================================================ */}
                {/* RIGHT COLUMN: Star Gaze Publish Preview (Desktop only, Sticky) */}
                {/* ============================================================ */}
                <div className="hidden lg:block w-[340px] shrink-0 sticky top-24">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                        {/* Preview header */}
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                            <Eye className="w-4 h-4 text-cyan-400" />
                            <span className="text-sm font-semibold text-white">{SHOP_TEXT.review.previewTitle[lang]}</span>
                        </div>

                        {/* Phone mockup */}
                        <div className="p-4">
                            <div className="relative bg-gray-900 rounded-[24px] border-2 border-gray-700 overflow-hidden" style={{ aspectRatio: '9/16' }}>
                                {/* Video background */}
                                {previewVideoSrc ? (
                                    <video
                                        key={previewVideoSrc}
                                        src={previewVideoSrc}
                                        className="absolute inset-0 w-full h-full object-cover"
                                        muted
                                        playsInline
                                        loop
                                        autoPlay
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                                        <FileVideo className="w-12 h-12 text-gray-700" />
                                    </div>
                                )}

                                {/* Overlay gradient */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />

                                {/* Content overlay */}
                                <div className="absolute bottom-0 left-0 right-0 p-4 space-y-2.5">
                                    {/* Account info */}
                                    {selectedAccount && (
                                        <div className="flex items-center gap-2">
                                            {selectedAccount.avatar_url ? (
                                                <img src={selectedAccount.avatar_url} className="w-7 h-7 rounded-full object-cover border border-white/20" alt="" />
                                            ) : (
                                                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#00F2EA] to-[#EC4899] flex items-center justify-center text-white text-xs font-bold">{(selectedAccount.display_name || 'S').charAt(0)}</div>
                                            )}
                                            <span className="text-white text-xs font-semibold drop-shadow-lg">@{selectedAccount.username || selectedAccount.display_name}</span>
                                        </div>
                                    )}

                                    {/* Caption */}
                                    {publishSettings.title && (
                                        <p className="text-white text-xs leading-relaxed drop-shadow-lg line-clamp-2">{publishSettings.title}</p>
                                    )}

                                    {/* Product anchor — unconditionally shown when product is selected */}
                                    {selectedProduct && (
                                        <div className="flex items-center gap-2 bg-orange-500/90 rounded-lg px-2.5 py-1.5 w-fit max-w-full">
                                            <ShoppingBag className="w-3.5 h-3.5 text-white shrink-0" />
                                            <span className="text-white text-[11px] font-medium truncate">{previewAnchorText}</span>
                                        </div>
                                    )}

                                    {/* Precheck badge */}
                                    {publishSettings.enable_precheck && (
                                        <div className="flex items-center gap-1">
                                            <ShieldCheck className="w-3 h-3 text-green-400" />
                                            <span className="text-green-400 text-[10px]">{SHOP_TEXT.review.precheckOn[lang]}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Preview notice */}
                        <div className="px-4 pb-4">
                            <p className="text-center text-[10px] text-gray-600 leading-relaxed">{SHOP_TEXT.review.previewNotice[lang]}</p>
                        </div>
                    </div>
                </div>

            </div>
            )}

            {/* ============================================================ */}
            {/* TASKS TAB */}
            {/* ============================================================ */}
            {activeTab === 'tasks' && (
                <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
                    <ShopTaskManager />
                </div>
            )}
        </div>
    );
}

// ============================================================
// Sub-components
// ============================================================

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
    return (
        <span className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors',
            ok
                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                : 'bg-white/5 text-gray-500 border-white/5'
        )}>
            {ok ? <Check className="w-3 h-3" /> : <div className="w-3 h-3 rounded-full border border-gray-600" />}
            {label}
        </span>
    );
}

function MobilePreview({ lang, previewVideoSrc, selectedAccount, publishSettings, selectedProduct, previewAnchorText }: {
    lang: Lang;
    previewVideoSrc: string | undefined;
    selectedAccount: { display_name: string | null; avatar_url: string | null; username: string | null } | undefined;
    publishSettings: ShopPublishSettingsData;
    selectedProduct: { id: string } | null;
    previewAnchorText: string;
}) {
    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                <Eye className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold text-white">{SHOP_TEXT.review.previewTitle[lang]}</span>
            </div>
            <div className="p-4">
                <div className="relative bg-gray-900 rounded-2xl overflow-hidden" style={{ aspectRatio: '16/9', maxHeight: '200px' }}>
                    {previewVideoSrc ? (
                        <video key={previewVideoSrc} src={previewVideoSrc} className="absolute inset-0 w-full h-full object-cover" muted playsInline loop autoPlay />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center"><FileVideo className="w-10 h-10 text-gray-700" /></div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
                    <div className="absolute bottom-0 left-0 right-0 p-3 flex items-end justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                            {selectedAccount && (
                                <span className="text-white text-[10px] font-semibold drop-shadow">@{selectedAccount.username || selectedAccount.display_name}</span>
                            )}
                            {publishSettings.title && <p className="text-white text-[10px] truncate drop-shadow">{publishSettings.title}</p>}
                        </div>
                        {selectedProduct && (
                            <div className="flex items-center gap-1 bg-orange-500/90 rounded px-2 py-1 shrink-0">
                                <ShoppingBag className="w-3 h-3 text-white" />
                                <span className="text-white text-[9px] font-medium max-w-[80px] truncate">{previewAnchorText}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <div className="px-4 pb-3">
                <p className="text-center text-[10px] text-gray-600">{SHOP_TEXT.review.previewNotice[lang]}</p>
            </div>
        </div>
    );
}
