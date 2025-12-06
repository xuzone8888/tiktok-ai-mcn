"use client";

/**
 * Chrome 扩展安装指南页面 - 简化版
 */

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  CheckCircle,
  Chrome,
  ArrowRight,
  Copy,
  Terminal,
  Sparkles,
  Apple,
  Monitor
} from "lucide-react";
import { useState } from "react";

export default function ExtensionPage() {
  const [copiedStep, setCopiedStep] = useState<number | null>(null);

  const macCommand1 = `mkdir -p ~/Desktop/tok-extractor && cat > ~/Desktop/tok-extractor/manifest.json << 'EOF'
{
  "manifest_version": 3,
  "name": "Tok Factory 商品提取器",
  "version": "1.0",
  "permissions": ["activeTab", "scripting"],
  "action": {"default_title": "提取商品数据"},
  "background": {"service_worker": "background.js"}
}
EOF`;

  const macCommand2 = `cat > ~/Desktop/tok-extractor/background.js << 'EOF'
chrome.action.onClicked.addListener(async(tab)=>{const r=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{const d={title:document.title,price:'',imgs:[]};const m=document.body.innerText.match(/[¥￥$]\\s*([\\d,.]+)/);if(m)d.price=m[1];document.querySelectorAll('img[src*="http"]').forEach(i=>{if(i.width>150&&i.height>150&&d.imgs.length<5)d.imgs.push(i.src)});d.imgs=[...new Set(d.imgs)];return d}});if(r&&r[0]&&r[0].result){chrome.tabs.create({url:'http://123.56.75.68:3000/link-video?data='+encodeURIComponent(JSON.stringify(r[0].result))})}});
EOF`;

  const winCommand1 = `mkdir %USERPROFILE%\\Desktop\\tok-extractor`;
  
  const winManifest = `{
  "manifest_version": 3,
  "name": "Tok Factory 商品提取器",
  "version": "1.0",
  "permissions": ["activeTab", "scripting"],
  "action": {"default_title": "提取商品数据"},
  "background": {"service_worker": "background.js"}
}`;

  const winBackground = `chrome.action.onClicked.addListener(async(tab)=>{const r=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{const d={title:document.title,price:'',imgs:[]};const m=document.body.innerText.match(/[¥￥$]\\s*([\\d,.]+)/);if(m)d.price=m[1];document.querySelectorAll('img[src*="http"]').forEach(i=>{if(i.width>150&&i.height>150&&d.imgs.length<5)d.imgs.push(i.src)});d.imgs=[...new Set(d.imgs)];return d}});if(r&&r[0]&&r[0].result){chrome.tabs.create({url:'http://123.56.75.68:3000/link-video?data='+encodeURIComponent(JSON.stringify(r[0].result))})}});`;

  const handleCopy = (text: string, step: number) => {
    navigator.clipboard.writeText(text);
    setCopiedStep(step);
    setTimeout(() => setCopiedStep(null), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      {/* 标题 */}
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-3">
          <Chrome className="h-12 w-12 text-blue-500" />
          <h1 className="text-3xl font-bold">一键提取扩展安装</h1>
        </div>
        <p className="text-lg text-muted-foreground">
          安装后，在商品页面点一下，数据自动导入！
        </p>
      </div>

      {/* 效果预览 */}
      <Card className="p-6 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-green-500/30">
        <div className="flex items-center gap-4">
          <Sparkles className="h-8 w-8 text-green-500" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold">安装后的使用方式</h3>
            <p className="text-muted-foreground">
              打开商品页面 → 点击扩展图标 → 完成！
            </p>
          </div>
          <div className="flex items-center gap-2 text-2xl">
            <span>🛒</span>
            <ArrowRight className="h-5 w-5" />
            <span>🖱️</span>
            <ArrowRight className="h-5 w-5" />
            <span>✅</span>
          </div>
        </div>
      </Card>

      {/* macOS 安装 */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Apple className="h-6 w-6" />
          <h2 className="text-2xl font-bold">macOS 安装（3步完成）</h2>
        </div>

        {/* 步骤 1 */}
        <Card className="p-4">
          <div className="flex items-start gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white font-bold text-sm">
              1
            </div>
            <div className="flex-1 space-y-3">
              <p className="font-medium">打开「终端」，粘贴第一条命令，按回车</p>
              <p className="text-sm text-muted-foreground">（在启动台搜索"终端"）</p>
              <div className="relative">
                <pre className="bg-zinc-900 text-zinc-100 p-3 rounded-lg text-xs overflow-x-auto">
                  {macCommand1}
                </pre>
                <Button
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => handleCopy(macCommand1, 1)}
                >
                  {copiedStep === 1 ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* 步骤 2 */}
        <Card className="p-4">
          <div className="flex items-start gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white font-bold text-sm">
              2
            </div>
            <div className="flex-1 space-y-3">
              <p className="font-medium">继续粘贴第二条命令，按回车</p>
              <div className="relative">
                <pre className="bg-zinc-900 text-zinc-100 p-3 rounded-lg text-xs overflow-x-auto">
                  {macCommand2}
                </pre>
                <Button
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => handleCopy(macCommand2, 2)}
                >
                  {copiedStep === 2 ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-sm text-green-600 dark:text-green-400">
                ✅ 完成！桌面上会出现 tok-extractor 文件夹
              </p>
            </div>
          </div>
        </Card>

        {/* 步骤 3 */}
        <Card className="p-4 border-green-500/30 bg-green-500/5">
          <div className="flex items-start gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white font-bold text-sm">
              3
            </div>
            <div className="flex-1 space-y-3">
              <p className="font-medium">安装到 Chrome</p>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Chrome 地址栏输入 <code className="bg-muted px-2 py-0.5 rounded">chrome://extensions/</code></li>
                <li>打开右上角「<strong>开发者模式</strong>」开关</li>
                <li>点击「<strong>加载已解压的扩展程序</strong>」</li>
                <li>选择桌面上的 <code className="bg-muted px-2 py-0.5 rounded">tok-extractor</code> 文件夹</li>
              </ol>
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                🎉 安装完成！以后在商品页面点击扩展图标即可
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Windows 安装 */}
      <details className="space-y-4">
        <summary className="flex items-center gap-2 cursor-pointer">
          <Monitor className="h-6 w-6" />
          <h2 className="text-xl font-bold">Windows 安装（点击展开）</h2>
        </summary>

        <Card className="p-4 mt-4">
          <div className="space-y-4">
            <div>
              <p className="font-medium mb-2">步骤 1：创建文件夹</p>
              <p className="text-sm text-muted-foreground">在桌面创建文件夹，命名为 <code className="bg-muted px-2 py-0.5 rounded">tok-extractor</code></p>
            </div>

            <div>
              <p className="font-medium mb-2">步骤 2：创建 manifest.json</p>
              <p className="text-sm text-muted-foreground mb-2">用记事本创建文件，复制以下内容，保存到文件夹（保存类型选"所有文件"）：</p>
              <div className="relative">
                <pre className="bg-zinc-900 text-zinc-100 p-3 rounded-lg text-xs overflow-x-auto">
                  {winManifest}
                </pre>
                <Button
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => handleCopy(winManifest, 3)}
                >
                  {copiedStep === 3 ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div>
              <p className="font-medium mb-2">步骤 3：创建 background.js</p>
              <p className="text-sm text-muted-foreground mb-2">用记事本创建另一个文件：</p>
              <div className="relative">
                <pre className="bg-zinc-900 text-zinc-100 p-3 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap break-all">
                  {winBackground}
                </pre>
                <Button
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => handleCopy(winBackground, 4)}
                >
                  {copiedStep === 4 ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div>
              <p className="font-medium mb-2">步骤 4：安装扩展</p>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Chrome 地址栏输入 <code className="bg-muted px-2 py-0.5 rounded">chrome://extensions/</code></li>
                <li>打开「开发者模式」</li>
                <li>点击「加载已解压的扩展程序」</li>
                <li>选择 tok-extractor 文件夹</li>
              </ol>
            </div>
          </div>
        </Card>
      </details>

      {/* 使用方法 */}
      <Card className="p-6 border-amber-500/30 bg-amber-500/5">
        <h3 className="text-lg font-semibold mb-4">🎯 使用方法（超简单）</h3>
        <div className="flex items-center gap-4 text-muted-foreground">
          <div className="text-center">
            <div className="text-3xl mb-1">🛒</div>
            <p className="text-sm">打开商品页面</p>
          </div>
          <ArrowRight className="h-6 w-6 shrink-0" />
          <div className="text-center">
            <div className="text-3xl mb-1">🖱️</div>
            <p className="text-sm">点击扩展图标</p>
          </div>
          <ArrowRight className="h-6 w-6 shrink-0" />
          <div className="text-center">
            <div className="text-3xl mb-1">✅</div>
            <p className="text-sm">自动导入完成</p>
          </div>
        </div>
      </Card>

      {/* 返回按钮 */}
      <div className="text-center">
        <Button variant="outline" asChild>
          <a href="/link-video">
            <ArrowRight className="h-4 w-4 mr-2 rotate-180" />
            返回链接秒变视频
          </a>
        </Button>
      </div>
    </div>
  );
}
