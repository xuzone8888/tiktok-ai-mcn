/**
 * 图片上传 API
 * 将本地图片上传到阿里云 OSS，返回公网 URL
 * 
 * 已迁移：Supabase Storage -> 阿里云 OSS
 */

import { NextResponse } from "next/server";
import {
  uploadImageBuffer,
  generateImagePath,
  isOSSConfigured
} from "@/lib/oss";
import { createAdminClient } from "@/lib/supabase/admin";

// 从用户 session 获取 userId（如果有的话）
async function getUserId(request: Request): Promise<string> {
  try {
    // 尝试从 cookie 获取 session
    const supabase = createAdminClient();
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const { data } = await supabase.auth.getUser(token);
      if (data.user?.id) {
        return data.user.id;
      }
    }
  } catch {
    // 忽略错误，使用默认 ID
  }
  // 默认用户 ID（未登录时使用）
  return 'anonymous';
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    }

    // 验证文件类型
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: "Invalid file type. Only JPEG, PNG, WebP, GIF allowed" },
        { status: 400 }
      );
    }

    // 验证文件大小 (最大 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: "File too large. Maximum 10MB" },
        { status: 400 }
      );
    }

    // 检查 OSS 配置
    if (!isOSSConfigured()) {
      console.error("[Upload Image] OSS not configured");
      return NextResponse.json(
        { success: false, error: "Storage service not configured" },
        { status: 500 }
      );
    }

    // 获取用户 ID
    const userId = await getUserId(request);

    // 生成 OSS 路径
    const objectPath = generateImagePath(userId, file.name);

    // 上传到阿里云 OSS
    const arrayBuffer = await file.arrayBuffer();
    const publicUrl = await uploadImageBuffer(arrayBuffer, objectPath, file.type);

    console.log("[Upload Image] Success:", publicUrl);

    return NextResponse.json({
      success: true,
      data: {
        url: publicUrl,
        path: objectPath,
      },
    });
  } catch (error) {
    console.error("[Upload Image] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to upload image" },
      { status: 500 }
    );
  }
}

