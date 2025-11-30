import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { mockProductStore } from "@/lib/mock-store";

// 创建 Supabase 客户端（仅在配置存在时）
function getSupabaseClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    return null;
  }
  
  return createClient(supabaseUrl, supabaseKey);
}

// 模拟九宫格图片 URLs（实际项目中这会是 AI 生成的图片）
const MOCK_GRID_IMAGES = [
  "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1560343090-f0409e92791a?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1491553895911-0055uj?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=400&h=400&fit=crop",
];

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const name = formData.get("name") as string;

    if (!file || !name) {
      return NextResponse.json(
        { error: "File and name are required" },
        { status: 400 }
      );
    }

    // 生成唯一文件名
    const fileExt = file.name.split(".").pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `products/${fileName}`;

    // 将 File 转换为 ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // 获取 Supabase 客户端
    const supabase = getSupabaseClient();

    // 上传到 Supabase Storage（如果 Supabase 已配置）
    let imageUrl: string = MOCK_GRID_IMAGES[0];
    
    if (supabase) {
      try {
        const { error: uploadError } = await supabase.storage
          .from("assets")
          .upload(filePath, buffer, {
            contentType: file.type,
            upsert: false,
          });

        if (uploadError) {
          console.warn("Storage upload failed, using mock URL:", uploadError.message);
        } else {
          // 获取公共 URL
          const { data: urlData } = supabase.storage
            .from("assets")
            .getPublicUrl(filePath);
          imageUrl = urlData.publicUrl;
        }
      } catch {
        console.warn("Storage not configured, using mock URL");
      }
    }

    // 模拟用户 ID（实际项目中从 session 获取）
    const mockUserId = "00000000-0000-0000-0000-000000000001";

    // 创建产品记录
    let product;
    
    if (supabase) {
      try {
        const { data: productData, error: productError } = await supabase
          .from("products")
          .insert({
            user_id: mockUserId,
            name: name,
            original_image_url: imageUrl,
            status: "processing",
            category: "general",
            tags: [],
          })
          .select()
          .single();

        if (productError) {
          console.warn("Database insert failed, using mock product:", productError.message);
          product = createMockProduct(mockUserId, name, imageUrl);
        } else {
          product = productData;
        }
      } catch {
        console.warn("Database not configured, using mock product");
        product = createMockProduct(mockUserId, name, imageUrl);
      }
    } else {
      product = createMockProduct(mockUserId, name, imageUrl);
    }

    // 存储初始状态到内存
    mockProductStore.set(product.id, {
      name: name,
      original_image_url: imageUrl,
      status: "processing",
      processed_images: null,
      created_at: product.created_at,
      updated_at: product.updated_at,
    });

    // 启动后台模拟处理（5秒后完成）
    simulateAIProcessing(product.id);

    return NextResponse.json({
      success: true,
      product: {
        ...product,
        processed_images: null, // 初始状态没有处理后的图片
      },
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}

function createMockProduct(userId: string, name: string, imageUrl: string) {
  return {
    id: `mock-${Date.now()}`,
    user_id: userId,
    name: name,
    original_image_url: imageUrl,
    status: "processing",
    category: "general",
    tags: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// 模拟 AI 处理过程（5秒后更新产品状态）
async function simulateAIProcessing(productId: string) {
  // 等待 5 秒模拟 AI 处理
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const processedImages = {
    grid_images: MOCK_GRID_IMAGES,
    processed_at: new Date().toISOString(),
    metadata: {
      width: 400,
      height: 400,
      format: "jpeg",
    },
  };

  const supabase = getSupabaseClient();
  
  if (supabase) {
    try {
      const { error } = await supabase
        .from("products")
        .update({
          status: "ready",
          processed_images: processedImages,
          processed_at: new Date().toISOString(),
        })
        .eq("id", productId);

      if (error) {
        console.warn("Failed to update product status:", error.message);
      }
    } catch (error) {
      console.warn("Database update failed:", error);
    }
  }

  // 存储到内存中用于模拟（当数据库不可用时）
  const existing = mockProductStore.get(productId);
  mockProductStore.set(productId, {
    name: existing?.name || "上传的产品",
    original_image_url: existing?.original_image_url || MOCK_GRID_IMAGES[0],
    status: "ready",
    processed_images: processedImages,
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}
