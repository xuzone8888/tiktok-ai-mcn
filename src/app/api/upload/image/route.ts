/**
 * 图片上传 API
 * 将本地图片上传到 Supabase Storage，返回公网 URL
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

    const supabase = createAdminClient();

    // 生成唯一文件名
    const ext = file.name.split(".").pop() || "jpg";
    const fileName = `quick-gen/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

    // 上传到 Supabase Storage
    const arrayBuffer = await file.arrayBuffer();
    const { error } = await supabase.storage
      .from("uploads")
      .upload(fileName, arrayBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (error) {
      console.error("[Upload Image] Storage error:", error);
      
      // 如果 bucket 不存在，尝试创建
      if (error.message.includes("not found")) {
        const { error: createError } = await supabase.storage.createBucket("uploads", {
          public: true,
        });
        
        if (!createError) {
          // 重试上传
          const { error: retryError } = await supabase.storage
            .from("uploads")
            .upload(fileName, arrayBuffer, {
              contentType: file.type,
              upsert: false,
            });
          
          if (retryError) {
            return NextResponse.json(
              { success: false, error: retryError.message },
              { status: 500 }
            );
          }
          
          // 获取公网 URL
          const { data: urlData } = supabase.storage
            .from("uploads")
            .getPublicUrl(fileName);
          
          return NextResponse.json({
            success: true,
            data: {
              url: urlData.publicUrl,
              path: fileName,
            },
          });
        }
      }
      
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    // 获取公网 URL
    const { data: urlData } = supabase.storage
      .from("uploads")
      .getPublicUrl(fileName);

    console.log("[Upload Image] Success:", urlData.publicUrl);

    return NextResponse.json({
      success: true,
      data: {
        url: urlData.publicUrl,
        path: fileName,
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

