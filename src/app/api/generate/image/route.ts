/**
 * 图片生成 API - NanoBanana
 * 
 * POST /api/generate/image - 提交图片生成任务
 * GET /api/generate/image?taskId=xxx&model=xxx - 查询任务状态
 */

import { NextResponse } from "next/server";
import { 
  submitNanoBanana, 
  queryNanoBananaResult,
  upscaleImage,
  generateNineGrid,
} from "@/lib/suchuang-api";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// 积分配置
// ============================================================================

// NanoBanana 积分配置
const NANO_BANANA_CREDITS = {
  "nano-banana": {
    "fast": 10,   // 快速模式
    "pro": 28,    // Pro 模式
  },
  "nano-banana-pro": {
    "1k": 30,     // 1K 分辨率
    "2k": 50,     // 2K 分辨率
    "4k": 80,     // 4K 分辨率
  },
};

// 图片增强积分配置
const ENHANCEMENT_CREDITS = {
  "upscale_2k": 40,   // 放大到 2K
  "upscale_4k": 70,   // 放大到 4K
  "nine_grid": 60,    // 九宫格多角度
};

// ============================================================================
// POST - 提交图片生成任务
// ============================================================================

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    const { 
      mode,           // "generate" | "upscale" | "nine_grid"
      prompt,
      sourceImageUrl,
      model = "nano-banana",        // "nano-banana" | "nano-banana-pro"
      tier = "fast",                // "fast" | "pro" (for nano-banana)
      aspectRatio = "auto",
      resolution = "1k",            // "1k" | "2k" | "4k" (for nano-banana-pro)
      userId,
    } = body;

    // ============================================
    // 计算积分消耗
    // ============================================
    let creditCost = 0;
    
    if (mode === "upscale") {
      creditCost = resolution === "4k" 
        ? ENHANCEMENT_CREDITS.upscale_4k 
        : ENHANCEMENT_CREDITS.upscale_2k;
    } else if (mode === "nine_grid") {
      creditCost = ENHANCEMENT_CREDITS.nine_grid;
    } else {
      // 普通生成
      if (model === "nano-banana-pro") {
        creditCost = NANO_BANANA_CREDITS["nano-banana-pro"][resolution as "1k" | "2k" | "4k"] || 30;
      } else {
        creditCost = tier === "pro" 
          ? NANO_BANANA_CREDITS["nano-banana"].pro 
          : NANO_BANANA_CREDITS["nano-banana"].fast;
      }
    }

    // ============================================
    // 扣除积分
    // ============================================
    if (userId) {
      const supabase = createAdminClient();
      
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", userId)
        .single();
      
      if (profileError || !profileData) {
        return NextResponse.json(
          { success: false, error: "User not found" },
          { status: 404 }
        );
      }
      
      const currentCredits = (profileData as { credits: number }).credits;
      
      if (currentCredits < creditCost) {
        return NextResponse.json(
          { success: false, error: `积分不足！需要 ${creditCost} 积分，当前余额 ${currentCredits}` },
          { status: 400 }
        );
      }
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: deductError } = await (supabase as any)
        .from("profiles")
        .update({ credits: currentCredits - creditCost })
        .eq("id", userId);
      
      if (deductError) {
        console.error("[Generate Image] Failed to deduct credits:", deductError);
        return NextResponse.json(
          { success: false, error: "Failed to deduct credits" },
          { status: 500 }
        );
      }
      
      console.log("[Generate Image] Credits deducted:", {
        userId,
        mode,
        cost: creditCost,
        before: currentCredits,
        after: currentCredits - creditCost,
      });
    }

    // ============================================
    // 根据模式提交任务
    // ============================================
    let result: { success: boolean; taskId?: string; error?: string };

    if (mode === "upscale") {
      // 图片放大高清
      if (!sourceImageUrl) {
        return NextResponse.json(
          { success: false, error: "Source image URL is required for upscale" },
          { status: 400 }
        );
      }
      
      console.log("[Generate Image] Upscaling image:", {
        sourceImageUrl: sourceImageUrl.substring(0, 50) + "...",
        targetResolution: resolution,
      });
      
      result = await upscaleImage(
        sourceImageUrl, 
        resolution as "2k" | "4k"
      );
      
    } else if (mode === "nine_grid") {
      // 九宫格多角度
      if (!sourceImageUrl) {
        return NextResponse.json(
          { success: false, error: "Source image URL is required for nine grid" },
          { status: 400 }
        );
      }
      
      console.log("[Generate Image] Generating nine grid:", {
        sourceImageUrl: sourceImageUrl.substring(0, 50) + "...",
        productDescription: prompt,
      });
      
      result = await generateNineGrid(sourceImageUrl, prompt);
      
    } else {
      // 普通图片生成
      if (!prompt || prompt.trim().length < 3) {
        return NextResponse.json(
          { success: false, error: "Prompt must be at least 3 characters" },
          { status: 400 }
        );
      }
      
      console.log("[Generate Image] Generating image:", {
        model,
        prompt: prompt.substring(0, 50) + "...",
        hasSourceImage: !!sourceImageUrl,
        aspectRatio,
        resolution: model === "nano-banana-pro" ? resolution : undefined,
      });
      
      result = await submitNanoBanana({
        model: model as "nano-banana" | "nano-banana-pro",
        prompt,
        img_url: sourceImageUrl,
        aspectRatio: aspectRatio as "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4",
        resolution: model === "nano-banana-pro" ? resolution as "1k" | "2k" | "4k" : undefined,
      });
    }

    if (!result.success) {
      console.error("[Generate Image] Submit failed:", result.error);
      
      // 退还积分
      if (userId) {
        try {
          const supabase = createAdminClient();
          const { data: refundProfile } = await supabase
            .from("profiles")
            .select("credits")
            .eq("id", userId)
            .single();
          
          if (refundProfile) {
            const refundCredits = (refundProfile as { credits: number }).credits;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from("profiles")
              .update({ credits: refundCredits + creditCost })
              .eq("id", userId);
            
            console.log("[Generate Image] Credits refunded:", creditCost);
          }
        } catch (refundError) {
          console.error("[Generate Image] Failed to refund:", refundError);
        }
      }
      
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    console.log("[Generate Image] Task submitted:", {
      taskId: result.taskId,
      mode,
      model,
    });

    return NextResponse.json({
      success: true,
      data: {
        taskId: result.taskId,
        status: "processing",
        model: mode === "upscale" || mode === "nine_grid" ? "nano-banana-pro" : model,
        estimatedTime: "30-60 seconds",
      },
    });
  } catch (error) {
    console.error("[Generate Image] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET - 查询任务状态
// ============================================================================

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    const model = searchParams.get("model") || "nano-banana";

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required" },
        { status: 400 }
      );
    }

    console.log("[Generate Image] Querying task:", taskId, { model });

    const result = await queryNanoBananaResult(
      taskId, 
      model as "nano-banana" | "nano-banana-pro"
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    const task = result.task!;

    return NextResponse.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: task.status,
        imageUrl: task.resultUrl,
        errorMessage: task.errorMessage,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    });
  } catch (error) {
    console.error("[Generate Image] Query error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

