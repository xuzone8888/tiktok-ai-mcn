import { NextRequest, NextResponse } from "next/server";
import { mockContracts, mockModels, mockUser } from "@/lib/mock-data";
import type { Contract, AIModel } from "@/types/model";

interface ContractWithModel extends Contract {
  ai_models: AIModel | null;
}

// GET: 获取用户合约
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const includeModel = searchParams.get("include_model") === "true";

    // 获取所有合约
    let contracts = Array.from(mockContracts.values()).filter(
      (c) => c.user_id === mockUser.id
    );

    // 检查并更新过期合约
    contracts = contracts.map((contract) => {
      if (contract.status === "active" && new Date(contract.end_date) <= new Date()) {
        contract.status = "expired";
        mockContracts.set(contract.model_id, contract);
      }
      return contract;
    });

    // 按状态过滤
    if (status) {
      contracts = contracts.filter((c) => c.status === status);
    }

    // 是否包含模特信息
    if (includeModel) {
      const contractsWithModels: ContractWithModel[] = contracts.map((contract) => {
        const model = mockModels.find((m) => m.id === contract.model_id) || null;
        return {
          ...contract,
          ai_models: model,
        };
      });

      return NextResponse.json(contractsWithModels);
    }

    return NextResponse.json(contracts);
  } catch (error) {
    console.error("Error fetching contracts:", error);
    return NextResponse.json(
      { error: "Failed to fetch contracts" },
      { status: 500 }
    );
  }
}

// POST: 创建新合约（签约模特）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { model_id, rental_period } = body;

    if (!model_id || !rental_period) {
      return NextResponse.json(
        { error: "model_id and rental_period are required" },
        { status: 400 }
      );
    }

    // 检查模特是否存在
    const model = mockModels.find((m) => m.id === model_id);
    if (!model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    // 检查是否已有有效合约
    const existingContract = mockContracts.get(model_id);
    if (existingContract && existingContract.status === "active" && new Date(existingContract.end_date) > new Date()) {
      return NextResponse.json(
        { error: "Already have an active contract with this model" },
        { status: 400 }
      );
    }

    // 计算价格
    const prices: Record<string, number> = {
      daily: model.price_daily,
      weekly: model.price_weekly,
      monthly: model.price_monthly,
      yearly: model.price_yearly,
    };
    const price = prices[rental_period] || model.price_monthly;

    // 检查积分
    if (mockUser.credits < price) {
      return NextResponse.json(
        { error: "Insufficient credits", required: price, available: mockUser.credits },
        { status: 400 }
      );
    }

    // 扣除积分
    mockUser.credits -= price;

    // 计算结束日期
    const startDate = new Date();
    const endDate = new Date();
    switch (rental_period) {
      case "daily":
        endDate.setDate(endDate.getDate() + 1);
        break;
      case "weekly":
        endDate.setDate(endDate.getDate() + 7);
        break;
      case "monthly":
        endDate.setMonth(endDate.getMonth() + 1);
        break;
      case "yearly":
        endDate.setFullYear(endDate.getFullYear() + 1);
        break;
    }

    // 创建合约
    const contract: Contract = {
      id: `contract-${Date.now()}`,
      user_id: mockUser.id,
      model_id,
      rental_period,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      status: "active",
      credits_paid: price,
      generations_count: 0,
      auto_renew: false,
      created_at: startDate.toISOString(),
    };

    mockContracts.set(model_id, contract);

    return NextResponse.json({
      success: true,
      contract,
      new_balance: mockUser.credits,
    });
  } catch (error) {
    console.error("Error creating contract:", error);
    return NextResponse.json(
      { error: "Failed to create contract" },
      { status: 500 }
    );
  }
}
