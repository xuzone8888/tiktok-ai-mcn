/**
 * Viral Clone — 图片上传凭证
 * POST /api/viral-clone/upload/image-credentials
 *
 * 审计采纳 3.2: 新增图片 MIME 支持
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateMediaPath, getPublicUrl } from '@/lib/oss';

const OSS = require('ali-oss');

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const { filename, content_type } = await request.json();

    if (!filename || !content_type) {
      return NextResponse.json({ success: false, error: '缺少 filename 或 content_type' }, { status: 400 });
    }

    // 白名单: 仅图片类型
    const validImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validImageTypes.includes(content_type)) {
      return NextResponse.json({
        success: false,
        error: `不支持的图片格式: ${content_type}，支持 jpeg/png/webp/gif`,
      }, { status: 400 });
    }

    // 生成 OSS 路径
    const ossKey = generateMediaPath('images', user.id, filename);
    const publicUrl = getPublicUrl(ossKey);

    // 生成签名 PUT URL
    const ossClient = new OSS({
      region: process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
      accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID,
      accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET,
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
      },
    });
  } catch (error) {
    console.error('[VC Image Credentials] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '服务器错误',
    }, { status: 500 });
  }
}
