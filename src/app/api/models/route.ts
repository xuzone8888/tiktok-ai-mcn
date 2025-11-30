/**
 * 前台模特 API - 公开接口
 * 
 * ⚠️ 安全注意：此 API 返回的数据会暴露给前端用户
 * 必须剔除敏感字段如 trigger_word
 */

import { NextRequest, NextResponse } from "next/server";
import { mockModels, mockContracts } from "@/lib/mock-data";

// 需要从响应中剔除的敏感字段
const SENSITIVE_FIELDS = ["trigger_word", "metadata"] as const;

/**
 * 剔除敏感字段，返回安全的模特数据
 */
function sanitizeModelData<T extends Record<string, unknown>>(model: T): Omit<T, typeof SENSITIVE_FIELDS[number]> {
  const sanitized = { ...model };
  for (const field of SENSITIVE_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const featured = searchParams.get("featured");
  const trending = searchParams.get("trending");

  try {
    let models = [...mockModels];

    // 只返回激活状态的模特给前台
    models = models.filter((m) => m.is_active);

    // 筛选
    if (category && category !== "all") {
      models = models.filter((m) => m.category.toLowerCase() === category.toLowerCase());
    }

    if (featured === "true") {
      models = models.filter((m) => m.is_featured);
    }

    if (trending === "true") {
      models = models.filter((m) => m.is_trending);
    }

    // 添加合约状态，并剔除敏感字段
    const modelsWithContractStatus = models.map((model) => {
      const contract = mockContracts.get(model.id);
      const hasActiveContract = contract && 
        contract.status === "active" && 
        new Date(contract.end_date) > new Date();
      
      // ⚠️ 关键：剔除敏感字段 (trigger_word 等)
      const safeModel = sanitizeModelData(model);
      
      return {
        ...safeModel,
        has_active_contract: hasActiveContract,
        contract: hasActiveContract ? contract : null,
      };
    });

    return NextResponse.json(modelsWithContractStatus);
  } catch (error) {
    console.error("Error fetching models:", error);
    return NextResponse.json(
      { error: "Failed to fetch models" },
      { status: 500 }
    );
  }
}



