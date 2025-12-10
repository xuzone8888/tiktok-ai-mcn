/**
 * GET /api/image-factory/task/[id]
 * 
 * 查询电商图片任务状态（带轮询更新）
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { queryNanoBananaResult } from "@/lib/suchuang-api";
import type { OutputItem, EcomTaskStatus } from "@/types/ecom-image";

// Vercel 函数配置
export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    // 1. 验证用户身份
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "任务ID不能为空" },
        { status: 400 }
      );
    }

    // 2. 获取任务信息
    const adminClient = createAdminClient();
    const { data: task, error: taskError } = await adminClient
      .from("ecom_image_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无权访问" },
        { status: 404 }
      );
    }

    // 3. 如果任务正在生成图片，检查 Nano Banana 任务状态
    if (task.status === "generating_images") {
      const outputItems = task.output_items as OutputItem[] || [];
      let hasUpdates = false;
      let completedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < outputItems.length; i++) {
        const item = outputItems[i];
        
        // 只检查正在处理中的项
        if (item.status === "processing" && item.task_id) {
          const result = await queryNanoBananaResult(item.task_id);
          
          // 修复：正确读取返回格式 { success, task: { status, resultUrl } }
          if (result.success && result.task?.status === "completed" && result.task?.resultUrl) {
            outputItems[i] = {
              ...item,
              status: "completed",
              url: result.task.resultUrl,
            };
            hasUpdates = true;
            completedCount++;
          } else if (result.task?.status === "failed" || !result.success) {
            outputItems[i] = {
              ...item,
              status: "failed",
              error: result.task?.errorMessage || result.error || "图片生成失败",
            };
            hasUpdates = true;
            failedCount++;
          } else {
            // 仍在处理中
          }
        } else if (item.status === "completed") {
          completedCount++;
        } else if (item.status === "failed") {
          failedCount++;
        }
      }

      // 4. 如果有更新，保存到数据库
      if (hasUpdates) {
        // 计算完成状态
        const totalCount = outputItems.length;
        const processingCount = outputItems.filter(item => item.status === "processing").length;
        
        let newStatus: EcomTaskStatus = "generating_images";
        
        if (processingCount === 0) {
          // 所有任务都已完成
          if (failedCount === totalCount) {
            newStatus = "failed";
          } else if (failedCount > 0) {
            newStatus = "partial_success";
          } else {
            newStatus = "success";
          }
        }

        const updateData: Record<string, unknown> = {
          output_items: outputItems,
          status: newStatus,
        };

        if (newStatus === "success" || newStatus === "partial_success" || newStatus === "failed") {
          updateData.completed_at = new Date().toISOString();
        }

        if (failedCount > 0 && failedCount < totalCount) {
          updateData.error_message = `${failedCount}/${totalCount} 张图片生成失败`;
        } else if (failedCount === totalCount) {
          updateData.error_message = "所有图片生成失败";
        } else {
          updateData.error_message = null;
        }

        await adminClient
          .from("ecom_image_tasks")
          .update(updateData)
          .eq("id", taskId);

        // 更新返回的任务对象
        Object.assign(task, updateData);
        task.output_items = outputItems;
      }
    }

    // 5. 返回任务信息
    return NextResponse.json({
      success: true,
      task,
    });

  } catch (error) {
    console.error("[Task Status] Error:", error);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

