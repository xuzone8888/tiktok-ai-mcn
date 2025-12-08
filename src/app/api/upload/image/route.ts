/**
 * 图片上传 API
 * 将本地图片上传到 Supabase Storage，返回公网 URL
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 延长 Vercel 函数超时时间
export const maxDuration = 30; // 30秒

// 带超时的 Promise 封装
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

export async function POST(request: Request) {
  const startTime = Date.now();
  
  try {
    console.log("[Upload Image] Starting upload...");
    
    // 解析 FormData（带超时）
    let formData: FormData;
    try {
      formData = await withTimeout(
        request.formData(),
        15000,
        "请求解析超时，请检查网络连接"
      );
    } catch (parseError) {
      console.error("[Upload Image] FormData parse error:", parseError);
      return NextResponse.json(
        { success: false, error: parseError instanceof Error ? parseError.message : "请求解析失败" },
        { status: 400 }
      );
    }
    
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    }

    console.log("[Upload Image] File info:", {
      name: file.name,
      type: file.type,
      size: file.size,
    });

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

    // 创建 Supabase 客户端
    let supabase;
    try {
      supabase = createAdminClient();
    } catch (clientError) {
      console.error("[Upload Image] Supabase client error:", clientError);
      return NextResponse.json(
        { success: false, error: "存储服务初始化失败，请稍后重试" },
        { status: 500 }
      );
    }

    // 生成唯一文件名
    const ext = file.name.split(".").pop() || "jpg";
    const fileName = `quick-gen/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

    // 读取文件内容（带超时）
    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await withTimeout(
        file.arrayBuffer(),
        10000,
        "文件读取超时"
      );
    } catch (readError) {
      console.error("[Upload Image] File read error:", readError);
      return NextResponse.json(
        { success: false, error: readError instanceof Error ? readError.message : "文件读取失败" },
        { status: 500 }
      );
    }

    // 上传到 Supabase Storage（带超时）
    let uploadError;
    try {
      const uploadResult = await withTimeout(
        supabase.storage.from("uploads").upload(fileName, arrayBuffer, {
          contentType: file.type,
          upsert: false,
        }),
        20000,
        "图片上传超时，请检查网络连接"
      );
      uploadError = uploadResult.error;
    } catch (timeoutError) {
      console.error("[Upload Image] Upload timeout:", timeoutError);
      return NextResponse.json(
        { success: false, error: timeoutError instanceof Error ? timeoutError.message : "上传超时" },
        { status: 500 }
      );
    }

    if (uploadError) {
      console.error("[Upload Image] Storage error:", uploadError);
      
      // 如果 bucket 不存在，尝试创建
      if (uploadError.message.includes("not found")) {
        try {
          const { error: createError } = await supabase.storage.createBucket("uploads", {
            public: true,
          });
          
          if (!createError) {
            // 重试上传
            const { error: retryError } = await withTimeout(
              supabase.storage.from("uploads").upload(fileName, arrayBuffer, {
                contentType: file.type,
                upsert: false,
              }),
              15000,
              "重试上传超时"
            );
            
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
            
            console.log("[Upload Image] Success after bucket creation:", urlData.publicUrl, "duration:", Date.now() - startTime, "ms");
            
            return NextResponse.json({
              success: true,
              data: {
                url: urlData.publicUrl,
                path: fileName,
              },
            });
          }
        } catch (bucketError) {
          console.error("[Upload Image] Bucket creation error:", bucketError);
        }
      }
      
      return NextResponse.json(
        { success: false, error: uploadError.message || "存储上传失败" },
        { status: 500 }
      );
    }

    // 获取公网 URL
    const { data: urlData } = supabase.storage
      .from("uploads")
      .getPublicUrl(fileName);

    console.log("[Upload Image] Success:", urlData.publicUrl, "duration:", Date.now() - startTime, "ms");

    return NextResponse.json({
      success: true,
      data: {
        url: urlData.publicUrl,
        path: fileName,
      },
    });
  } catch (error) {
    console.error("[Upload Image] Unexpected error:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "图片上传失败，请重试" 
      },
      { status: 500 }
    );
  }
}

