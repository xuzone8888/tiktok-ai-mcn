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
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Authentication required. Please log in first." },
        { status: 401 }
      );
    }

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

    // 生成 OSS 路径
    const objectPath = generateImagePath(user.id, file.name);

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

