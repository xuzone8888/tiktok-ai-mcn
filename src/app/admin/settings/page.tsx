"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CreditCard,
  Megaphone,
  Settings,
  Save,
  Loader2,
  CheckCircle2,
  DollarSign,
  Bitcoin,
  Wallet,
  Bell,
  Link,
  Eye,
  AlertTriangle,
  Info,
  XCircle,
  Clock,
  Zap,
  Video,
  Image,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ============================================================================
// 类型定义
// ============================================================================

interface PaymentInfo {
  bank_name: string;
  bank_account: string;
  bank_holder: string;
  usdt_address: string;
  usdt_network: string;
  alipay_account: string;
  wechat_account: string;
  notes: string;
}

interface AnnouncementConfig {
  enabled: boolean;
  content: string;
  type: "info" | "warning" | "error" | "success";
  link_url?: string;
  link_text?: string;
  dismissible: boolean;
}

interface PricingConfig {
  video_10s_credits: number;
  video_15s_credits: number;
  video_25s_credits: number;
  nano_banana_fast_credits: number;
  nano_banana_pro_credits: number;
}

interface SystemSettings {
  payment_info: PaymentInfo;
  announcement: AnnouncementConfig;
  pricing: PricingConfig;
  maintenance_mode: boolean;
  updated_at: string;
  updated_by: string;
}

// ============================================================================
// Admin Settings Page
// ============================================================================

export default function AdminSettingsPage() {
  const { toast } = useToast();

  // 状态
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  // 表单状态
  const [paymentForm, setPaymentForm] = useState<PaymentInfo>({
    bank_name: "",
    bank_account: "",
    bank_holder: "",
    usdt_address: "",
    usdt_network: "TRC20",
    alipay_account: "",
    wechat_account: "",
    notes: "",
  });

  const [announcementForm, setAnnouncementForm] = useState<AnnouncementConfig>({
    enabled: false,
    content: "",
    type: "info",
    link_url: "",
    link_text: "",
    dismissible: true,
  });

  const [pricingForm, setPricingForm] = useState<PricingConfig>({
    video_10s_credits: 20,
    video_15s_credits: 350,
    video_25s_credits: 350,
    nano_banana_fast_credits: 10,
    nano_banana_pro_credits: 28,
  });

  const [maintenanceMode, setMaintenanceMode] = useState(false);

  // ================================================================
  // 数据获取
  // ================================================================

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/settings?scope=admin");
      const data = await res.json();

      if (data.success) {
        const s = data.data as SystemSettings;
        setSettings(s);
        setPaymentForm(s.payment_info);
        setAnnouncementForm(s.announcement);
        setPricingForm(s.pricing);
        setMaintenanceMode(s.maintenance_mode);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Failed to fetch settings:", error);
      toast({
        variant: "destructive",
        title: "获取设置失败",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ================================================================
  // 保存函数
  // ================================================================

  const saveSection = async (section: string, data: unknown) => {
    setSaving(section);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, data }),
      });

      const result = await res.json();

      if (result.success) {
        toast({
          title: "保存成功",
          description: `${section} 配置已更新`,
        });
        fetchSettings();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error("Save error:", error);
      toast({
        variant: "destructive",
        title: "保存失败",
      });
    } finally {
      setSaving(null);
    }
  };

  // ================================================================
  // 渲染
  // ================================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">System Settings</h1>
          <p className="text-muted-foreground">
            配置收款信息、全站公告和系统参数
          </p>
        </div>
        {settings && (
          <div className="text-xs text-muted-foreground">
            <Clock className="inline h-3 w-3 mr-1" />
            Last updated: {new Date(settings.updated_at).toLocaleString("zh-CN")}
            <br />
            by {settings.updated_by}
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="payment" className="space-y-6">
        <TabsList className="bg-black/30 border border-white/10">
          <TabsTrigger value="payment" className="data-[state=active]:bg-white/10">
            <CreditCard className="h-4 w-4 mr-2" />
            收款信息
          </TabsTrigger>
          <TabsTrigger value="announcement" className="data-[state=active]:bg-white/10">
            <Megaphone className="h-4 w-4 mr-2" />
            全站公告
          </TabsTrigger>
          <TabsTrigger value="pricing" className="data-[state=active]:bg-white/10">
            <Zap className="h-4 w-4 mr-2" />
            积分定价
          </TabsTrigger>
          <TabsTrigger value="system" className="data-[state=active]:bg-white/10">
            <Settings className="h-4 w-4 mr-2" />
            系统
          </TabsTrigger>
        </TabsList>

        {/* ============================================ */}
        {/* 收款信息 Tab */}
        {/* ============================================ */}
        <TabsContent value="payment" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-green-400" />
                银行账户信息
              </CardTitle>
              <CardDescription>
                用户充值时展示的银行收款账户
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    银行名称
                  </Label>
                  <Input
                    value={paymentForm.bank_name}
                    onChange={(e) =>
                      setPaymentForm((prev) => ({ ...prev, bank_name: e.target.value }))
                    }
                    placeholder="招商银行"
                    className="bg-black/30 border-white/10"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    账户持有人
                  </Label>
                  <Input
                    value={paymentForm.bank_holder}
                    onChange={(e) =>
                      setPaymentForm((prev) => ({ ...prev, bank_holder: e.target.value }))
                    }
                    placeholder="公司名称或个人姓名"
                    className="bg-black/30 border-white/10"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">
                  银行账号
                </Label>
                <Input
                  value={paymentForm.bank_account}
                  onChange={(e) =>
                    setPaymentForm((prev) => ({ ...prev, bank_account: e.target.value }))
                  }
                  placeholder="6225 8888 8888 8888"
                  className="bg-black/30 border-white/10 font-mono"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bitcoin className="h-5 w-5 text-amber-400" />
                加密货币收款
              </CardTitle>
              <CardDescription>
                USDT 等加密货币收款地址
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    USDT 地址
                  </Label>
                  <Input
                    value={paymentForm.usdt_address}
                    onChange={(e) =>
                      setPaymentForm((prev) => ({ ...prev, usdt_address: e.target.value }))
                    }
                    placeholder="TXyz...abc123"
                    className="bg-black/30 border-white/10 font-mono"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    网络
                  </Label>
                  <Select
                    value={paymentForm.usdt_network}
                    onValueChange={(v) =>
                      setPaymentForm((prev) => ({ ...prev, usdt_network: v }))
                    }
                  >
                    <SelectTrigger className="bg-black/30 border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-black/95 border-white/10">
                      <SelectItem value="TRC20">TRC20 (Tron)</SelectItem>
                      <SelectItem value="ERC20">ERC20 (Ethereum)</SelectItem>
                      <SelectItem value="BEP20">BEP20 (BSC)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-blue-400" />
                第三方支付
              </CardTitle>
              <CardDescription>
                支付宝、微信等第三方支付账号
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    支付宝账号
                  </Label>
                  <Input
                    value={paymentForm.alipay_account}
                    onChange={(e) =>
                      setPaymentForm((prev) => ({ ...prev, alipay_account: e.target.value }))
                    }
                    placeholder="pay@example.com"
                    className="bg-black/30 border-white/10"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    微信号
                  </Label>
                  <Input
                    value={paymentForm.wechat_account}
                    onChange={(e) =>
                      setPaymentForm((prev) => ({ ...prev, wechat_account: e.target.value }))
                    }
                    placeholder="wechat_id"
                    className="bg-black/30 border-white/10"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5 text-tiktok-cyan" />
                充值说明
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={paymentForm.notes}
                onChange={(e) =>
                  setPaymentForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="请在转账备注中填写您的注册邮箱..."
                rows={4}
                className="bg-black/30 border-white/10 resize-none"
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={() => saveSection("payment_info", paymentForm)}
              disabled={saving === "payment_info"}
              className="bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold"
            >
              {saving === "payment_info" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  保存收款信息
                </>
              )}
            </Button>
          </div>
        </TabsContent>

        {/* ============================================ */}
        {/* 全站公告 Tab */}
        {/* ============================================ */}
        <TabsContent value="announcement" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="h-5 w-5 text-tiktok-pink" />
                公告配置
              </CardTitle>
              <CardDescription>
                在用户端顶部显示全站公告通知
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 开关 */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                <div>
                  <p className="font-medium">启用公告</p>
                  <p className="text-sm text-muted-foreground">
                    开启后将在用户端导航栏下方显示公告
                  </p>
                </div>
                <Switch
                  checked={announcementForm.enabled}
                  onCheckedChange={(v) =>
                    setAnnouncementForm((prev) => ({ ...prev, enabled: v }))
                  }
                  className="data-[state=checked]:bg-tiktok-pink"
                />
              </div>

              {/* 公告内容 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">
                  公告内容
                </Label>
                <Textarea
                  value={announcementForm.content}
                  onChange={(e) =>
                    setAnnouncementForm((prev) => ({ ...prev, content: e.target.value }))
                  }
                  placeholder="🎉 新用户注册即送 100 积分！..."
                  rows={3}
                  className="bg-black/30 border-white/10 resize-none"
                />
              </div>

              {/* 公告类型 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">
                  公告类型
                </Label>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { value: "info", label: "通知", icon: Info, color: "tiktok-cyan" },
                    { value: "success", label: "成功", icon: CheckCircle2, color: "green-400" },
                    { value: "warning", label: "警告", icon: AlertTriangle, color: "amber-400" },
                    { value: "error", label: "错误", icon: XCircle, color: "red-400" },
                  ].map((type) => (
                    <button
                      key={type.value}
                      onClick={() =>
                        setAnnouncementForm((prev) => ({
                          ...prev,
                          type: type.value as AnnouncementConfig["type"],
                        }))
                      }
                      className={cn(
                        "p-3 rounded-xl border flex flex-col items-center gap-2 transition-all",
                        announcementForm.type === type.value
                          ? `bg-${type.color}/20 border-${type.color}/50`
                          : "bg-black/30 border-white/10 hover:bg-white/5"
                      )}
                    >
                      <type.icon className={cn("h-5 w-5", `text-${type.color}`)} />
                      <span className="text-xs">{type.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 链接配置 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    <Link className="inline h-3 w-3 mr-1" />
                    链接地址 (可选)
                  </Label>
                  <Input
                    value={announcementForm.link_url || ""}
                    onChange={(e) =>
                      setAnnouncementForm((prev) => ({ ...prev, link_url: e.target.value }))
                    }
                    placeholder="/quick-gen"
                    className="bg-black/30 border-white/10"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    链接文字
                  </Label>
                  <Input
                    value={announcementForm.link_text || ""}
                    onChange={(e) =>
                      setAnnouncementForm((prev) => ({ ...prev, link_text: e.target.value }))
                    }
                    placeholder="立即体验"
                    className="bg-black/30 border-white/10"
                  />
                </div>
              </div>

              {/* 可关闭开关 */}
              <div className="flex items-center gap-3">
                <Switch
                  checked={announcementForm.dismissible}
                  onCheckedChange={(v) =>
                    setAnnouncementForm((prev) => ({ ...prev, dismissible: v }))
                  }
                />
                <Label className="text-sm">允许用户关闭公告</Label>
              </div>

              {/* 预览 */}
              {announcementForm.enabled && announcementForm.content && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    <Eye className="inline h-3 w-3 mr-1" />
                    预览效果
                  </Label>
                  <div
                    className={cn(
                      "p-3 rounded-lg flex items-center justify-between",
                      announcementForm.type === "info" && "bg-tiktok-cyan/20 border border-tiktok-cyan/30 text-tiktok-cyan",
                      announcementForm.type === "success" && "bg-green-500/20 border border-green-500/30 text-green-400",
                      announcementForm.type === "warning" && "bg-amber-500/20 border border-amber-500/30 text-amber-400",
                      announcementForm.type === "error" && "bg-red-500/20 border border-red-500/30 text-red-400"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Bell className="h-4 w-4" />
                      <span className="text-sm">{announcementForm.content}</span>
                      {announcementForm.link_url && announcementForm.link_text && (
                        <span className="ml-2 underline text-sm font-medium">
                          {announcementForm.link_text} →
                        </span>
                      )}
                    </div>
                    {announcementForm.dismissible && (
                      <XCircle className="h-4 w-4 opacity-60 cursor-pointer hover:opacity-100" />
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={() => saveSection("announcement", announcementForm)}
              disabled={saving === "announcement"}
              className="bg-gradient-to-r from-tiktok-pink to-red-500 text-white font-semibold"
            >
              {saving === "announcement" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  保存公告配置
                </>
              )}
            </Button>
          </div>
        </TabsContent>

        {/* ============================================ */}
        {/* 积分定价 Tab */}
        {/* ============================================ */}
        <TabsContent value="pricing" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Video className="h-5 w-5 text-purple-400" />
                视频生成定价
              </CardTitle>
              <CardDescription>
                Sora 2 视频生成的积分消耗
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    10秒视频 (Sora 2)
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={pricingForm.video_10s_credits}
                      onChange={(e) =>
                        setPricingForm((prev) => ({
                          ...prev,
                          video_10s_credits: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="bg-black/30 border-white/10 pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      Credits
                    </span>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    15秒视频 (Sora 2 Pro)
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={pricingForm.video_15s_credits}
                      onChange={(e) =>
                        setPricingForm((prev) => ({
                          ...prev,
                          video_15s_credits: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="bg-black/30 border-white/10 pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      Credits
                    </span>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    25秒视频 (Sora 2 Pro)
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={pricingForm.video_25s_credits}
                      onChange={(e) =>
                        setPricingForm((prev) => ({
                          ...prev,
                          video_25s_credits: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="bg-black/30 border-white/10 pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      Credits
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Image className="h-5 w-5 text-tiktok-cyan" />
                图片处理定价
              </CardTitle>
              <CardDescription>
                Nano Banana 图片增强的积分消耗
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    Nano Banana (Fast)
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={pricingForm.nano_banana_fast_credits}
                      onChange={(e) =>
                        setPricingForm((prev) => ({
                          ...prev,
                          nano_banana_fast_credits: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="bg-black/30 border-white/10 pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      Credits
                    </span>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    Nano Banana (Pro)
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={pricingForm.nano_banana_pro_credits}
                      onChange={(e) =>
                        setPricingForm((prev) => ({
                          ...prev,
                          nano_banana_pro_credits: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="bg-black/30 border-white/10 pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      Credits
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={() => saveSection("pricing", pricingForm)}
              disabled={saving === "pricing"}
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold"
            >
              {saving === "pricing" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  保存定价配置
                </>
              )}
            </Button>
          </div>
        </TabsContent>

        {/* ============================================ */}
        {/* 系统 Tab */}
        {/* ============================================ */}
        <TabsContent value="system" className="space-y-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
                维护模式
              </CardTitle>
              <CardDescription>
                开启后，普通用户将无法访问系统
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <div>
                  <p className="font-medium text-amber-400">启用维护模式</p>
                  <p className="text-sm text-muted-foreground">
                    用户将看到&ldquo;系统维护中&rdquo;页面，Admin 可正常访问
                  </p>
                </div>
                <Switch
                  checked={maintenanceMode}
                  onCheckedChange={(v) => {
                    setMaintenanceMode(v);
                    saveSection("maintenance", { enabled: v });
                  }}
                  className="data-[state=checked]:bg-amber-500"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

