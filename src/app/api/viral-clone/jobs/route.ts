/**
 * Viral Clone — Job 详情 + 列表
 * GET /api/viral-clone/jobs — 任务列表
 * GET /api/viral-clone/jobs?id=xxx — 任务详情（前端轮询用）
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createVCAdminClient } from '@/lib/viral-clone/vc-supabase';

export async function GET(request: Request) {
  try {
    // 用 typed client 仅做鉴权
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    // 用 untyped client 查 viral_clone 表
    const vc = createVCAdminClient();
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('id');

    if (jobId) {
      const { data: job, error: jobError } = await vc
        .from('viral_clone_jobs')
        .select('*')
        .eq('id', jobId)
        .eq('user_id', user.id)
        .single();

      if (jobError || !job) {
        return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
      }

      const { data: segments } = await vc
        .from('viral_clone_segments')
        .select('*')
        .eq('job_id', jobId)
        .order('segment_index');

      const assetIds = [
        job.source_asset_id,
        job.final_asset_id,
        ...(segments?.map((s: Record<string, unknown>) => s.raw_asset_id).filter(Boolean) || []),
      ].filter(Boolean);

      let assets: Record<string, unknown>[] = [];
      if (assetIds.length > 0) {
        const { data } = await vc
          .from('viral_clone_assets')
          .select('*')
          .in('id', assetIds);
        assets = data || [];
      }

      const { data: events } = await vc
        .from('viral_clone_events')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(20);

      return NextResponse.json({
        success: true,
        data: { job, segments: segments || [], assets, events: events || [] },
      });
    } else {
      const page = parseInt(searchParams.get('page') || '1');
      const pageSize = parseInt(searchParams.get('pageSize') || '20');
      const offset = (page - 1) * pageSize;

      const { data: jobs, error: listError, count } = await vc
        .from('viral_clone_jobs')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (listError) {
        return NextResponse.json({ success: false, error: listError.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        data: { jobs: jobs || [], total: count || 0 },
      });
    }
  } catch (error) {
    console.error('[VC Jobs] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '服务器错误',
    }, { status: 500 });
  }
}
