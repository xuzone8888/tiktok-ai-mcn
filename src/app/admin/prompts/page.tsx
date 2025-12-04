"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Wand2,
  Save,
  RotateCcw,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// 默认提示词
const DEFAULT_PROMPTS = {
  talkingScriptSystem: `You are a professional short-form video script generator for TikTok e-commerce. You create engaging, viral-style product recommendation scripts that follow TikTok trends and best practices.`,
  
  talkingScriptUser: `Based on all the product images provided (the first image is a 3x3 high-resolution grid showing multiple angles of the product, and the following images provide extra details and usage scenes), extract the core selling points and write a TikTok selfie-style talking-head product recommendation script in English.

Requirements:
- Platform: TikTok short video product promotion, compliant with TikTok e-commerce and ad policies.
- Duration: about 15 seconds in total.
- Split the script into exactly 7 consecutive simple shots.
- For each shot, provide:
  - a shot code: C01, C02, C03, C04, C05, C06, C07
  - a visual description (what we see, framing, camera angle, product position)
  - detailed action of the creator (body movement, facial expression)
  - the spoken line in natural English (first person, influencer tone, very convincing and enthusiastic).
- The opening must be fun, eye-catching, and hook the viewer in the first seconds.
- The content must strongly plant the desire to buy, highlight benefits and key features clearly.
- Use simple, easy-to-understand language suitable for a broad TikTok audience.
- Do NOT include any explanations, comments, or meta text.
- Do NOT output any headings like 'Shot 1' or 'Explanation'.
- Output only the script content itself.
- Each shot should start with the shot code like: 'C01: ...', 'C02: ...', up to 'C07: ...'.`,

  aiVideoPromptSystem: `You are a TikTok e-commerce creator and AI video director. You specialize in turning talking-head product recommendation scripts into detailed shot-by-shot prompts for AI video generation models like Sora.`,

  aiVideoPromptUser: `Below is a 7-shot TikTok talking-head product recommendation script, with shot codes C01 to C07:

{{SCRIPT}}

Please rewrite this into an English, shot-by-shot AI video generation prompt suitable for a model like Sora2 Pro.

Requirements:
- Keep exactly 7 shots with the same shot codes: C01, C02, C03, C04, C05, C06, C07.
- For each shot, describe:
  - the camera framing and angle (e.g. close-up, medium shot, handheld, selfie angle),
  - the environment and background (e.g. bedroom, street, studio, etc.),
  - the lighting style and mood,
  - the creator's appearance, outfit, and key actions,
  - how the product is shown in the frame,
  - timing and pacing so that the total duration is about 15 seconds.
- Also suggest the style of background music for the entire video (mood, tempo, instruments), integrated into the description.
- Follow the logic of viral TikTok short videos:
  - very strong hook in C01,
  - show clear benefits and key features in the next shots,
  - end with a strong call-to-action and emotional push to buy.
- Do NOT output any tables.
- Do NOT include meta explanations or comments.
- Output only the final AI video prompt content.
- Each shot should start with its code like: 'C01: ...', 'C02: ...', etc.`,
};

export default function PromptsConfigPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // 提示词状态
  const [talkingScriptSystem, setTalkingScriptSystem] = useState(DEFAULT_PROMPTS.talkingScriptSystem);
  const [talkingScriptUser, setTalkingScriptUser] = useState(DEFAULT_PROMPTS.talkingScriptUser);
  const [aiVideoPromptSystem, setAiVideoPromptSystem] = useState(DEFAULT_PROMPTS.aiVideoPromptSystem);
  const [aiVideoPromptUser, setAiVideoPromptUser] = useState(DEFAULT_PROMPTS.aiVideoPromptUser);

  // 加载提示词配置
  useEffect(() => {
    const loadPrompts = async () => {
      try {
        const response = await fetch("/api/admin/prompts");
        const data = await response.json();
        
        if (data.success && data.data) {
          setTalkingScriptSystem(data.data.talkingScriptSystem || DEFAULT_PROMPTS.talkingScriptSystem);
          setTalkingScriptUser(data.data.talkingScriptUser || DEFAULT_PROMPTS.talkingScriptUser);
          setAiVideoPromptSystem(data.data.aiVideoPromptSystem || DEFAULT_PROMPTS.aiVideoPromptSystem);
          setAiVideoPromptUser(data.data.aiVideoPromptUser || DEFAULT_PROMPTS.aiVideoPromptUser);
        }
      } catch (error) {
        console.error("Failed to load prompts:", error);
      } finally {
        setLoading(false);
      }
    };

    loadPrompts();
  }, []);

  // 保存提示词
  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          talkingScriptSystem,
          talkingScriptUser,
          aiVideoPromptSystem,
          aiVideoPromptUser,
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        toast({ title: "✅ 提示词配置已保存" });
      } else {
        toast({ variant: "destructive", title: "保存失败", description: data.error });
      }
    } catch {
      toast({ variant: "destructive", title: "保存失败", description: "网络错误" });
    } finally {
      setSaving(false);
    }
  };

  // 重置为默认
  const handleReset = () => {
    setTalkingScriptSystem(DEFAULT_PROMPTS.talkingScriptSystem);
    setTalkingScriptUser(DEFAULT_PROMPTS.talkingScriptUser);
    setAiVideoPromptSystem(DEFAULT_PROMPTS.aiVideoPromptSystem);
    setAiVideoPromptUser(DEFAULT_PROMPTS.aiVideoPromptUser);
    toast({ title: "已重置为默认提示词" });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-purple-400" />
            提示词配置
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            配置批量视频生产中使用的 AI 提示词
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="h-4 w-4 mr-2" />
            重置默认
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            保存配置
          </Button>
        </div>
      </div>

      {/* 提示说明 */}
      <Card className="bg-amber-500/10 border-amber-500/30">
        <CardContent className="py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-400">重要提示</p>
              <p className="text-muted-foreground">
                修改提示词会影响所有新的批量视频生成任务。请谨慎修改，确保提示词格式正确。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 步骤1：生成口播脚本 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
              步骤 1
            </Badge>
            <FileText className="h-5 w-5 text-purple-400" />
            生成口播脚本提示词
          </CardTitle>
          <CardDescription>
            豆包 AI 根据产品图片生成 TikTok 口播脚本 (C01-C07)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-2 block">
              系统提示词 (System Prompt)
            </Label>
            <Textarea
              value={talkingScriptSystem}
              onChange={(e) => setTalkingScriptSystem(e.target.value)}
              className="min-h-[100px] font-mono text-sm"
              placeholder="输入系统提示词..."
            />
          </div>
          <div>
            <Label className="text-sm font-medium mb-2 block">
              用户提示词 (User Prompt)
            </Label>
            <Textarea
              value={talkingScriptUser}
              onChange={(e) => setTalkingScriptUser(e.target.value)}
              className="min-h-[300px] font-mono text-sm"
              placeholder="输入用户提示词..."
            />
          </div>
        </CardContent>
      </Card>

      {/* 步骤2：生成AI视频提示词 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
              步骤 2
            </Badge>
            <Wand2 className="h-5 w-5 text-amber-400" />
            生成 AI 视频提示词
          </CardTitle>
          <CardDescription>
            豆包 AI 将口播脚本转换为 Sora2 可用的分镜提示词
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-2 block">
              系统提示词 (System Prompt)
            </Label>
            <Textarea
              value={aiVideoPromptSystem}
              onChange={(e) => setAiVideoPromptSystem(e.target.value)}
              className="min-h-[100px] font-mono text-sm"
              placeholder="输入系统提示词..."
            />
          </div>
          <div>
            <Label className="text-sm font-medium mb-2 block">
              用户提示词模板 (User Prompt Template)
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              使用 {"{{SCRIPT}}"} 作为占位符，会被替换为步骤1生成的口播脚本
            </p>
            <Textarea
              value={aiVideoPromptUser}
              onChange={(e) => setAiVideoPromptUser(e.target.value)}
              className="min-h-[400px] font-mono text-sm"
              placeholder="输入用户提示词模板..."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}



