/**
 * Viral Clone — 视频上传初始化
 * POST /api/viral-clone/upload/init
 *
 * 创建 Job + Asset + 返回 OSS 签名上传 URL
 */

import { NextResponse } from 'next/server';
import OSS from 'ali-oss';
import { createClient } from '@/lib/supabase/server';
import { createVCAdminClient } from '@/lib/viral-clone/vc-supabase';
import { generateMediaPath, getPublicUrl } from '@/lib/oss';

export async function POST(request: Request) {
  try {
    // 验证用户
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { filename, content_type, file_size } = body;

    if (!filename || !content_type) {
      return NextResponse.json({ success: false, error: '缺少 filename 或 content_type' }, { status: 400 });
    }

    // 验证文件类型
    const validVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
    if (!validVideoTypes.includes(content_type)) {
      return NextResponse.json({ success: false, error: '不支持的视频格式' }, { status: 400 });
    }

    // Service Role Client（bypasses RLS）
    const adminClient = createVCAdminClient();

    // 创建 OSS 路径
    const ossKey = generateMediaPath('videos', user.id, filename);
    const publicUrl = getPublicUrl(ossKey);

    // 创建 Asset 记录
    const { data: asset, error: assetError } = await adminClient
      .from('viral_clone_assets')
      .insert({
        user_id: user.id,
        asset_type: 'source_video',
        url: publicUrl,
        oss_key: ossKey,
        filename,
        content_type,
        size_bytes: file_size || 0,
      })
      .select()
      .single();

    if (assetError) {
      return NextResponse.json({ success: false, error: `创建资产失败: ${assetError.message}` }, { status: 500 });
    }

    // 创建 Job 记录
    const { data: job, error: jobError } = await adminClient
      .from('viral_clone_jobs')
      .insert({
        user_id: user.id,
        entry_type: 'upload',
        status: 'created',
        source_asset_id: asset.id,
      })
      .select()
      .single();

    if (jobError) {
      return NextResponse.json({ success: false, error: `创建任务失败: ${jobError.message}` }, { status: 500 });
    }

    const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET;

    if (!accessKeyId || !accessKeySecret) {
      return NextResponse.json({ success: false, error: 'OSS 配置缺失' }, { status: 500 });
    }

    // 生成签名 PUT URL
    const ossClient = new OSS({
      region: process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
      accessKeyId,
      accessKeySecret,
      bucket: process.env.ALIYUN_OSS_BUCKET || 'tokfactory-videos',
    });

    const uploadUrl = ossClient.signatureUrl(ossKey, {
      method: 'PUT',
      expires: 3600,
      'Content-Type': content_type,
    });

    return NextResponse.json({
      success: true,
      data: {
        upload_url: uploadUrl,
        public_url: publicUrl,
        oss_key: ossKey,
        job_id: job.id,
        asset_id: asset.id,
      },
    });
  } catch (error) {
    console.error('[VC Upload Init] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '服务器错误',
    }, { status: 500 });
  }
}
