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

        const { data: task, error: lookupError } = await supabase
            .from('generations')
            .select('id, source')
            .eq('id', id)
            .eq('user_id', user.id)
            .maybeSingle()

        if (lookupError) {
            console.error('[Tasks API] Lookup error:', lookupError)
            return NextResponse.json(
                { success: false, error: "读取任务失败" },
                { status: 500 }
            )
        }

        if (!task) {
            return NextResponse.json(
                { success: false, error: "任务不存在" },
                { status: 404 }
            )
        }

        // Canvas generations are billing/audit records and can still be referenced by
        // persisted nodes. They must only be removed through a purpose-built archival
        // flow that preserves those invariants.
        if (task.source === 'canvas') {
            return NextResponse.json(
                { success: false, error: "画布生成记录不可删除" },
                { status: 409 }
            )
        }

        const { data: deletedTask, error } = await supabase
            .from('generations')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id)
            .or('source.is.null,source.neq.canvas')
            .select('id')
            .maybeSingle()

        if (error) {
            console.error('[Tasks API] Delete error:', error)
            return NextResponse.json(
                { success: false, error: "删除失败" },
                { status: 500 }
            )
        }

        if (!deletedTask) {
            return NextResponse.json(
                { success: false, error: "任务状态已变化，请刷新后重试" },
                { status: 409 }
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
