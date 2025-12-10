/**
 * POST /api/image-factory/generate-images
 * 
 * 为电商图片任务生成图片（调用 Nano Banana API）
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { submitNanoBanana } from "@/lib/suchuang-api";
import type { 
  EcomImageMode, 
  ImageModelType, 
  OutputItem,
  EcomAspectRatio,
  EcomResolution 
} from "@/types/ecom-image";
import { FIVE_PACK_TYPES } from "@/types/ecom-image";

// Vercel 函数配置
export const maxDuration = 60;

interface GenerateImagesRequest {
  task_id: string;
  prompts?: Record<string, string>; // 用户修改后的提示词（可选）
}

export async function POST(request: NextRequest) {
  try {
    // 1. 验证用户身份
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    // 2. 解析请求参数
    const body: GenerateImagesRequest = await request.json();
    const { task_id, prompts: userPrompts } = body;

    if (!task_id) {
      return NextResponse.json(
        { success: false, error: "任务ID不能为空" },
        { status: 400 }
      );
    }

    // 3. 获取任务信息
    const adminClient = createAdminClient();
    const { data: task, error: taskError } = await adminClient
      .from("ecom_image_tasks")
      .select("*")
      .eq("id", task_id)
      .eq("user_id", user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无权访问" },
        { status: 404 }
      );
    }

    // 4. 检查任务状态
    if (!["created", "generating_prompts", "generating_images", "failed"].includes(task.status)) {
      return NextResponse.json(
        { success: false, error: "任务状态不正确，无法生成图片" },
        { status: 400 }
      );
    }

    // 5. 获取提示词
    const taskPrompts = task.prompts as { original?: Record<string, string>; modified?: Record<string, string> } || {};
    const prompts = userPrompts || taskPrompts.modified || taskPrompts.original || {};

    // 如果用户提供了修改后的提示词，更新到任务中
    if (userPrompts && Object.keys(userPrompts).length > 0) {
      await adminClient
        .from("ecom_image_tasks")
        .update({
          prompts: {
            ...taskPrompts,
            modified: userPrompts,
          },
        })
        .eq("id", task_id);
    }

    // 6. 更新任务状态为"生成图片中"
    await adminClient
      .from("ecom_image_tasks")
      .update({
        status: "generating_images",
        current_step: 3,
        error_message: null,
      })
      .eq("id", task_id);

    // 7. 准备生成参数
    const mode = task.mode as EcomImageMode;
    const modelType = task.model_type as ImageModelType;
    const inputImages = task.input_image_urls as string[];
    const ratio = task.ratio as EcomAspectRatio;
    const resolution = task.resolution as EcomResolution | null;

    // 8. 根据模式生成输出项
    const outputItems: OutputItem[] = [];
    const nanoTaskIds: string[] = [];

    console.log("[Generate Images] Starting generation:", {
      taskId: task_id,
      mode,
      modelType,
      imageCount: inputImages.length,
      promptCount: Object.keys(prompts).length,
    });

    if (mode === "ecom_five_pack") {
      // 电商五图套装：生成 5 张图
      const fivePackTypes: Array<keyof typeof FIVE_PACK_TYPES> = ["main", "scene", "detail", "selling", "compare"];
      
      for (const type of fivePackTypes) {
        const prompt = prompts[type] || `Generate a ${type} image for e-commerce`;
        const typeConfig = FIVE_PACK_TYPES[type];
        
        // 提交 Nano Banana 任务
        const result = await submitNanoBanana({
          model: modelType,
          prompt,
          img_url: inputImages[0], // 使用第一张图作为参考
          aspectRatio: ratio === "auto" ? "1:1" : ratio,
          resolution: modelType === "nano-banana-pro" ? (resolution || "1k") : undefined,
        });

        const outputItem: OutputItem = {
          type,
          label: typeConfig.label,
          status: result.success ? "processing" : "failed",
          task_id: result.taskId,
          error: result.error,
          input_image_url: inputImages[0],
        };

        outputItems.push(outputItem);
        if (result.taskId) {
          nanoTaskIds.push(result.taskId);
        }
      }
    } else {
      // 其他模式：每张输入图生成一张输出图
      for (let i = 0; i < inputImages.length; i++) {
        const inputImage = inputImages[i];
        const promptKey = mode === "white_background" ? "white_bg" : Object.keys(prompts)[0] || "default";
        const prompt = prompts[promptKey] || getDefaultPrompt(mode);

        // 提交 Nano Banana 任务
        const result = await submitNanoBanana({
          model: modelType,
          prompt,
          img_url: inputImage,
          aspectRatio: ratio === "auto" ? undefined : ratio,
          resolution: modelType === "nano-banana-pro" ? (resolution || "1k") : undefined,
        });

        const outputItem: OutputItem = {
          type: mode === "white_background" ? "white_bg" : mode,
          label: getModeLabel(mode, i + 1),
          status: result.success ? "processing" : "failed",
          task_id: result.taskId,
          error: result.error,
          input_image_url: inputImage,
        };

        outputItems.push(outputItem);
        if (result.taskId) {
          nanoTaskIds.push(result.taskId);
        }
      }
    }

    // 9. 扣除积分
    if (!task.credits_charged && nanoTaskIds.length > 0) {
      // 获取当前积分
      const { data: profile } = await adminClient
        .from("profiles")
        .select("credits")
        .eq("id", user.id)
        .single();

      if (profile && profile.credits >= task.credits_cost) {
        const newBalance = profile.credits - task.credits_cost;
        
        // 扣除积分
        const { error: deductError } = await adminClient
          .from("profiles")
          .update({ credits: newBalance })
          .eq("id", user.id);

        if (!deductError) {
          // 记录交易
          await adminClient.from("credit_transactions").insert({
            user_id: user.id,
            amount: -task.credits_cost,
            type: "consume",
            description: `电商图片工厂 - ${getModeDisplayName(mode)}`,
            reference_type: "ecom_image_task",
            reference_id: task_id,
            balance_before: profile.credits,
            balance_after: newBalance,
          });

          // 更新任务
          await adminClient
            .from("ecom_image_tasks")
            .update({
              credits_charged: true,
              credits_charged_at: new Date().toISOString(),
            })
            .eq("id", task_id);
        } else {
          console.error("[Generate Images] Failed to deduct credits:", deductError);
        }
      }
    }

    // 10. 更新任务输出项
    const successCount = outputItems.filter(item => item.status === "processing").length;
    const failedCount = outputItems.filter(item => item.status === "failed").length;

    const newStatus = failedCount === outputItems.length ? "failed" : "generating_images";

    await adminClient
      .from("ecom_image_tasks")
      .update({
        output_items: outputItems,
        status: newStatus,
        error_message: failedCount > 0 
          ? `${failedCount}/${outputItems.length} 张图片生成失败` 
          : null,
      })
      .eq("id", task_id);

    console.log("[Generate Images] Tasks submitted:", {
      taskId: task_id,
      successCount,
      failedCount,
      nanoTaskIds,
    });

    return NextResponse.json({
      success: true,
      nano_task_ids: nanoTaskIds,
      output_items: outputItems,
      message: `已提交 ${successCount} 个图片生成任务`,
    });

  } catch (error) {
    console.error("[Generate Images] Error:", error);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

// 获取默认提示词 - 所有提示词都强调保持原产品不变
function getDefaultPrompt(mode: EcomImageMode): string {
  const keepProductPrefix = "Keep the EXACT SAME product from the reference image unchanged. Maintain all product details, colors, textures and shape exactly as shown.";
  
  switch (mode) {
    case "white_background":
      return `${keepProductPrefix} Place the product on a pure white background. Professional studio lighting, soft even illumination, no harsh shadows, no extra objects, no text, no watermark.`;
    case "scene_image":
      return `${keepProductPrefix} Place the product in a beautiful lifestyle scene with natural lighting, cozy atmosphere. The product must be clearly visible and identical to the reference.`;
    case "try_on":
      return `${keepProductPrefix} Show an AI model wearing/using the product with natural pose, professional fashion photography style. The product details must remain identical to the reference.`;
    case "buyer_show":
      return `${keepProductPrefix} Create a realistic buyer photo style with natural lighting, casual setting. The product must look exactly the same as in the reference image.`;
    default:
      return `${keepProductPrefix} Create a high quality e-commerce product image with professional lighting and clean presentation.`;
  }
}

// 获取模式标签
function getModeLabel(mode: EcomImageMode, index: number): string {
  switch (mode) {
    case "white_background":
      return `白底图 ${index}`;
    case "scene_image":
      return `场景图 ${index}`;
    case "try_on":
      return `试穿图 ${index}`;
    case "buyer_show":
      return `买家秀 ${index}`;
    default:
      return `图片 ${index}`;
  }
}

// 获取模式显示名称
function getModeDisplayName(mode: EcomImageMode): string {
  switch (mode) {
    case "ecom_five_pack":
      return "电商五图套装";
    case "white_background":
      return "一键白底图";
    case "scene_image":
      return "一键场景图";
    case "try_on":
      return "一键试穿";
    case "buyer_show":
      return "一键买家秀";
    default:
      return "图片生成";
  }
}

