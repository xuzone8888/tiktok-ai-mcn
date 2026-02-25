/**
 * 望景API 余额查询
 * GET /api/wangjing/balance
 */

import { NextResponse } from 'next/server';
import { getWangjingBalance } from '@/lib/suchuang-api';

export async function GET() {
    try {
        const result = await getWangjingBalance();

        if (!result.success) {
            return NextResponse.json(
                { success: false, error: result.error },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            balance: result.balance,
            balanceFormatted: result.balanceFormatted,
        });
    } catch (error) {
        console.error('[Wangjing Balance API] Error:', error);
        return NextResponse.json(
            { success: false, error: '余额查询失败' },
            { status: 500 }
        );
    }
}
