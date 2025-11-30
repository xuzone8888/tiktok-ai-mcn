/**
 * Admin API - 文件上传
 * 
 * POST /api/admin/upload - 上传文件到 Supabase Storage
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

    // 验证 bucket
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

    const supabase = createAdminClient();

    // 将 File 转换为 Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 上传到 Supabase Storage
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: true,
      });

    if (error) {
      console.error("[Upload API] Storage error:", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    // 获取公开 URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(data.path);

    console.log("[Upload API] File uploaded:", {
      bucket,
      path: data.path,
      publicUrl: urlData.publicUrl,
    });

    return NextResponse.json({
      success: true,
      data: {
        path: data.path,
        publicUrl: urlData.publicUrl,
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

