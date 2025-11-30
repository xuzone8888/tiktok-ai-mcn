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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  try {
    // 首先检查内存存储（用于模拟）
    const mockData = mockProductStore.get(id);
    
    // 尝试从数据库获取
    const supabase = getSupabaseClient();
    
    if (supabase) {
      try {
        const { data: product, error } = await supabase
          .from("products")
          .select("*")
          .eq("id", id)
          .single();

        if (error) {
          // 如果数据库查询失败，返回模拟数据
          if (mockData) {
            return NextResponse.json({
              id,
              status: mockData.status,
              processed_images: mockData.processed_images,
            });
          }
          return NextResponse.json({ error: "Product not found" }, { status: 404 });
        }

        // 合并数据库数据和模拟数据
        if (mockData && product.status === "processing") {
          return NextResponse.json({
            ...product,
            status: mockData.status,
            processed_images: mockData.processed_images,
          });
        }

        return NextResponse.json(product);
      } catch {
        // 数据库查询出错
      }
    }
    
    // 数据库不可用，使用模拟数据
    if (mockData) {
      return NextResponse.json({
        id,
        status: mockData.status,
        processed_images: mockData.processed_images,
      });
    }
    
    // 如果没有模拟数据，返回处理中状态
    return NextResponse.json({
      id,
      status: "processing",
      processed_images: null,
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    return NextResponse.json(
      { error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}

