import { NextRequest, NextResponse } from "next/server";
import { mockProductStore } from "@/lib/mock-store";
import type { Product } from "@/types/product";

// 模拟产品数据
const mockProducts: Product[] = [
  {
    id: "product-1",
    user_id: "00000000-0000-0000-0000-000000000001",
    name: "夏季连衣裙",
    description: "轻盈透气的夏季连衣裙",
    original_image_url: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400",
    status: "ready",
    category: "Fashion",
    tags: ["夏季", "连衣裙", "女装"],
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    processed_images: {
      grid_images: [
        "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1509631179647-0177331693ae?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1495385794356-15371f348c31?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1502716119720-b23a93e5fe1b?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1485968579580-b6d095142e6e?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1496217590455-aa63a8350eea?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=400&h=400&fit=crop",
      ],
      processed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: { width: 400, height: 400, format: "jpeg" },
    },
  },
  {
    id: "product-2",
    user_id: "00000000-0000-0000-0000-000000000001",
    name: "运动手表",
    description: "多功能运动手表",
    original_image_url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400",
    status: "ready",
    category: "Tech",
    tags: ["手表", "运动", "配饰"],
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    processed_images: {
      grid_images: [
        "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1560343090-f0409e92791a?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=400&h=400&fit=crop",
      ],
      processed_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: { width: 400, height: 400, format: "jpeg" },
    },
  },
  {
    id: "product-3",
    user_id: "00000000-0000-0000-0000-000000000001",
    name: "保湿面霜",
    description: "深层保湿护肤面霜",
    original_image_url: "https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400",
    status: "ready",
    category: "Beauty",
    tags: ["护肤", "面霜", "保湿"],
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    processed_images: {
      grid_images: [
        "https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1617897903246-719242758050?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1631729371254-42c2892f0e6e?w=400&h=400&fit=crop",
        "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=400&h=400&fit=crop",
      ],
      processed_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: { width: 400, height: 400, format: "jpeg" },
    },
  },
];

// GET: 获取产品列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    // 合并模拟产品和用户上传的产品
    const uploadedProducts: Product[] = [];
    for (const [id, data] of mockProductStore.entries()) {
      uploadedProducts.push({
        id,
        user_id: "00000000-0000-0000-0000-000000000001",
        name: data.name || `产品 ${id.slice(-4)}`,
        description: null,
        original_image_url: data.original_image_url || "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=400",
        status: data.status,
        category: "general",
        tags: [],
        created_at: data.created_at || new Date().toISOString(),
        updated_at: data.updated_at || new Date().toISOString(),
        processed_images: data.processed_images || null,
      });
    }

    let allProducts = [...uploadedProducts, ...mockProducts];

    // 按状态过滤
    if (status) {
      allProducts = allProducts.filter((p) => p.status === status);
    }

    // 按创建时间排序（最新的在前）
    allProducts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return NextResponse.json(allProducts);
  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}
