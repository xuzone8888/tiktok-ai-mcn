/**
 * 单个任务操作 API
 * 
 * DELETE /api/user/tasks/[id] - 删除过期/无效的任务
 */

import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        if (!id) {
            return NextResponse.json(
                { success: false, error: "缺少任务 ID" },
                { status: 400 }
            )
        }

        const supabase = await createServerClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json(
                { success: false, error: "请先登录" },
                { status: 401 }
            )
        }

        // Delete from generations table (only user's own task)
        const { error } = await supabase
            .from('generations')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id)

        if (error) {
            console.error('[Tasks API] Delete error:', error)
            return NextResponse.json(
                { success: false, error: "删除失败" },
                { status: 500 }
            )
        }

        console.log(`[Tasks API] Deleted task ${id} for user ${user.id}`)

        return NextResponse.json({
            success: true,
            message: "任务已删除"
        })

    } catch (error) {
        console.error('[Tasks API] Error:', error)
        return NextResponse.json(
            { success: false, error: "删除失败" },
            { status: 500 }
        )
    }
}
