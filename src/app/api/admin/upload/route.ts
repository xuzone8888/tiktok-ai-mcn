/**
 * Admin API - 文件上传
 * 
 * POST /api/admin/upload - 上传文件到阿里云 OSS
 * 
 * 已迁移：Supabase Storage -> 阿里云 OSS
 * 支持的文件夹：model-avatars, model-demos, user-uploads
 */

import { NextResponse } from "next/server";
import {
  uploadBuffer,
  generateMediaPath,
  isOSSConfigured,
  getContentType,
  StorageFolder
} from "@/lib/oss";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const bucket = formData.get("bucket") as string | null;
    const path = formData.get("path") as string | null;

    if (!file || !bucket || !path) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: file, bucket, path" },
        { status: 400 }
      );
    }

    // 验证 bucket（现在映射到 OSS folder）
    const validBuckets = ["model-avatars", "model-demos", "user-uploads"];
    if (!validBuckets.includes(bucket)) {
      return NextResponse.json(
        { success: false, error: "Invalid bucket" },
        { status: 400 }
      );
    }

    // 验证文件大小
    const maxSizes: Record<string, number> = {
      "model-avatars": 5 * 1024 * 1024,    // 5MB
      "model-demos": 100 * 1024 * 1024,    // 100MB
      "user-uploads": 50 * 1024 * 1024,    // 50MB
    };

    if (file.size > maxSizes[bucket]) {
      return NextResponse.json(
        { success: false, error: `File too large. Max size: ${maxSizes[bucket] / (1024 * 1024)}MB` },
        { status: 400 }
      );
    }

    // 检查 OSS 配置
    if (!isOSSConfigured()) {
      console.error("[Upload API] OSS not configured");
      return NextResponse.json(
        { success: false, error: "Storage service not configured" },
        { status: 500 }
      );
    }

    console.log("[Upload API] Starting upload:", {
      bucket,
      path,
      fileSize: file.size,
      fileType: file.type,
    });

    // 将 File 转换为 Buffer
    const arrayBuffer = await file.arrayBuffer();

    // 生成 OSS 路径：使用原始 path 中的信息或生成新路径
    // 如果 path 包含用户 ID 或其他结构，保留原有结构
    const ossFolder = bucket as StorageFolder;
    let objectPath: string;

    if (path.includes('/')) {
      // 保留原有路径结构，但加上 bucket 前缀
      objectPath = `${bucket}/${path}`;
    } else {
      // 简单文件名，生成完整路径
      objectPath = generateMediaPath(ossFolder, 'admin', file.name);
    }

    // 获取正确的 Content-Type
    const contentType = file.type || getContentType(file.name);

    // 上传到阿里云 OSS
    const publicUrl = await uploadBuffer(arrayBuffer, objectPath, contentType);

    console.log("[Upload API] File uploaded:", {
      bucket,
      path: objectPath,
      publicUrl,
    });

    return NextResponse.json({
      success: true,
      data: {
        path: objectPath,
        publicUrl,
      },
    });
  } catch (error) {
    console.error("[Upload API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Upload failed" },
      { status: 500 }
    );
  }
}

