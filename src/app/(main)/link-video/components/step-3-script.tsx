"use client";

/**
 * Step 3: 生成带货脚本
 */

import { useState, useEffect } from "react";
import { useLinkVideoStore } from "@/stores/link-video-store";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Loader2,
  Check,
  Edit3,
  Eye,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LINK_VIDEO_CREDITS, isScriptRewriteCharged } from "@/types/link-video";

export function Step3Script() {
  const {
    currentJob,
    scriptText,
    setScriptText,
    isGeneratingScript,
    startGenerateScript,
    setScriptGenerated,
    setScriptError,
    scriptError,
    scriptVersion,
    prevStep,
    nextStep,
  } = useLinkVideoStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editedScript, setEditedScript] = useState(scriptText);
  const [rewriteCount, setRewriteCount] = useState(0);

  // 同步编辑内容
  useEffect(() => {
    setEditedScript(scriptText);
  }, [scriptText]);

  // 生成脚本
  const handleGenerateScript = async (isRewrite = false) => {
    startGenerateScript();

    try {
      // 如果没有 job，需要先创建
      let jobId = currentJob?.id;
      
      if (!jobId) {
        // 从 store 获取数据创建 job
        const store = useLinkVideoStore.getState();
        const createResponse = await fetch("/api/link-video/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product_link_id: store.productLinkId,
            manual_product_info: store.manualProductInfo,
            video_config: store.videoConfig,
            ai_model_id: store.selectedModelId,
            selected_main_image_url: store.primaryImageUrl,
            selected_image_urls: store.selectedImages
              .filter(i => i.selected)
              .map(i => i.url),
          }),
        });

        const createResult = await createResponse.json();
        if (!createResult.success) {
          setScriptError(createResult.error || "创建任务失败");
          return;
        }

        jobId = createResult.job.id;
        useLinkVideoStore.getState().setCurrentJob(createResult.job);
      }

      // 调用脚本生成 API
      const response = await fetch(`/api/link-video/jobs/${jobId}/script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewrite: isRewrite }),
      });

      const result = await response.json();

      if (result.success) {
        setScriptGenerated(result.script, result.version || scriptVersion + 1);
        if (isRewrite) {
          setRewriteCount(prev => prev + 1);
        }
      } else {
        setScriptError(result.error || "脚本生成失败");
      }
    } catch (error) {
      setScriptError("网络错误，请稍后重试");
    }
  };

  // 保存编辑
  const handleSaveEdit = () => {
    setScriptText(editedScript);
    setIsEditing(false);
  };

  // 判断重写是否收费
  const rewriteCharged = isScriptRewriteCharged(rewriteCount);
  const rewriteCost = rewriteCharged ? LINK_VIDEO_CREDITS.script_rewrite : 0;

  const canProceed = scriptText.trim().length > 0;

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">生成带货脚本</h2>
          <p className="text-sm text-muted-foreground mt-1">
            AI 根据商品信息生成分镜脚本
          </p>
        </div>
        {scriptVersion > 0 && (
          <Badge variant="outline">
            版本 {scriptVersion}
          </Badge>
        )}
      </div>

      {/* 脚本区域 */}
      {!scriptText && !isGeneratingScript && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8">
          <p className="text-muted-foreground mb-4">点击下方按钮生成脚本</p>
          <Button
            onClick={() => handleGenerateScript(false)}
            className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            生成脚本
          </Button>
        </div>
      )}

      {isGeneratingScript && (
        <div className="flex flex-col items-center justify-center rounded-lg border p-8">
          <Loader2 className="h-8 w-8 animate-spin text-tiktok-cyan mb-4" />
          <p className="text-muted-foreground">AI 正在撰写带货脚本...</p>
          <p className="text-xs text-muted-foreground mt-1">
            预计需要 10-30 秒
          </p>
        </div>
      )}

      {scriptError && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p>{scriptError}</p>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-destructive"
              onClick={() => handleGenerateScript(false)}
            >
              重试
            </Button>
          </div>
        </div>
      )}

      {scriptText && !isGeneratingScript && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>脚本内容</Label>
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                    取消
                  </Button>
                  <Button size="sm" onClick={handleSaveEdit}>
                    <Check className="mr-1 h-3 w-3" />
                    保存
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                    <Edit3 className="mr-1 h-3 w-3" />
                    编辑
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateScript(true)}
                    disabled={isGeneratingScript}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" />
                    重写
                    {rewriteCost > 0 && (
                      <Badge variant="secondary" className="ml-1 text-xs">
                        {rewriteCost} 积分
                      </Badge>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>

          {isEditing ? (
            <Textarea
              value={editedScript}
              onChange={(e) => setEditedScript(e.target.value)}
              rows={15}
              className="font-mono text-sm"
            />
          ) : (
            <div className="rounded-lg border bg-muted/30 p-4">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                {scriptText}
              </pre>
            </div>
          )}

          {/* 脚本说明 */}
          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <p className="font-medium mb-1">脚本格式说明：</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>C01, C02... 表示不同镜头</li>
              <li>[Visual] 描述画面内容</li>
              <li>[Action] 描述动作表情</li>
              <li>[Line] 为口播台词</li>
            </ul>
          </div>
        </div>
      )}

      {/* 免费重写次数提示 */}
      {scriptVersion > 0 && (
        <div className="text-xs text-muted-foreground">
          已重写 {rewriteCount} 次
          {!rewriteCharged && (
            <span>（还有 {LINK_VIDEO_CREDITS.script_free_rewrites - rewriteCount} 次免费机会）</span>
          )}
        </div>
      )}

      {/* 导航按钮 */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={prevStep}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          上一步
        </Button>
        <Button
          onClick={nextStep}
          disabled={!canProceed}
          className="bg-gradient-to-r from-tiktok-cyan to-tiktok-pink hover:opacity-90"
        >
          下一步：生成九宫格
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

