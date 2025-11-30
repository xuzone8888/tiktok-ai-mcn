import { NextRequest, NextResponse } from "next/server";
import { mockUser, mockContracts } from "@/lib/mock-data";

// 模拟生成结果存储
const generationsStore = new Map<string, {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  type: "video" | "image";
  output_url?: string;
  thumbnail_url?: string;
  created_at: string;
  completed_at?: string;
}>();

// 模拟输出 URLs
const MOCK_VIDEO_OUTPUTS = [
  "https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4",
  "https://www.w3schools.com/html/mov_bbb.mp4",
];

const MOCK_IMAGE_OUTPUTS = [
  "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800",
  "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800",
  "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800",
];

// POST: 创建生成任务
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { model_id, product_id, type, script, template } = body;

    if (!model_id || !type) {
      return NextResponse.json(
        { error: "model_id and type are required" },
        { status: 400 }
      );
    }

    // 检查是否有有效合约
    const contract = mockContracts.get(model_id);
    if (!contract || contract.status !== "active" || new Date(contract.end_date) <= new Date()) {
      return NextResponse.json(
        { error: "No active contract for this model" },
        { status: 400 }
      );
    }

    // 计算消耗积分
    const creditsRequired = type === "video" ? 50 : 10;

    if (mockUser.credits < creditsRequired) {
      return NextResponse.json(
        { error: "Insufficient credits", required: creditsRequired, available: mockUser.credits },
        { status: 400 }
      );
    }

    // 扣除积分
    mockUser.credits -= creditsRequired;

    // 创建生成任务
    const generationId = `gen-${Date.now()}`;
    const generation = {
      id: generationId,
      user_id: mockUser.id,
      model_id,
      product_id: product_id || null,
      type,
      status: "processing" as const,
      progress: 0,
      input_params: { script, template },
      credits_used: creditsRequired,
      created_at: new Date().toISOString(),
    };

    generationsStore.set(generationId, {
      id: generationId,
      status: "processing",
      progress: 0,
      type,
      created_at: new Date().toISOString(),
    });

    // 启动模拟生成过程
    simulateGeneration(generationId, type);

    return NextResponse.json({
      success: true,
      generation: generation,
      new_balance: mockUser.credits,
    });
  } catch (error) {
    console.error("Generation error:", error);
    return NextResponse.json(
      { error: "Failed to create generation" },
      { status: 500 }
    );
  }
}

// GET: 获取生成任务状态
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (id) {
    const generation = generationsStore.get(id);
    if (!generation) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }
    return NextResponse.json(generation);
  }

  // 返回所有生成记录
  const generations = Array.from(generationsStore.values());
  return NextResponse.json(generations);
}

// 模拟生成过程（10秒）
async function simulateGeneration(generationId: string, type: "video" | "image") {
  const totalDuration = 10000; // 10 seconds
  const updateInterval = 500; // Update every 500ms
  const steps = totalDuration / updateInterval;

  for (let i = 1; i <= steps; i++) {
    await new Promise((resolve) => setTimeout(resolve, updateInterval));
    
    const generation = generationsStore.get(generationId);
    if (generation) {
      generation.progress = Math.round((i / steps) * 100);
      generationsStore.set(generationId, generation);
    }
  }

  // 完成生成
  const generation = generationsStore.get(generationId);
  if (generation) {
    generation.status = "completed";
    generation.progress = 100;
    generation.completed_at = new Date().toISOString();
    
    if (type === "video") {
      generation.output_url = MOCK_VIDEO_OUTPUTS[Math.floor(Math.random() * MOCK_VIDEO_OUTPUTS.length)];
      generation.thumbnail_url = MOCK_IMAGE_OUTPUTS[Math.floor(Math.random() * MOCK_IMAGE_OUTPUTS.length)];
    } else {
      generation.output_url = MOCK_IMAGE_OUTPUTS[Math.floor(Math.random() * MOCK_IMAGE_OUTPUTS.length)];
    }
    
    generationsStore.set(generationId, generation);
  }
}



