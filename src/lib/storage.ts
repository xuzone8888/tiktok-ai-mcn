/**
 * Supabase Storage 工具库
 * 
 * 提供文件上传、下载、删除等功能
 * 
 * Buckets:
 *   - model-avatars: 模特头像 (公开)
 *   - model-demos: 模特视频 (公开)
 *   - user-uploads: 用户上传 (私有)
 */

// ============================================================================
// 类型定义
// ============================================================================

export type StorageBucket = 'model-avatars' | 'model-demos' | 'user-uploads';

export interface UploadOptions {
  bucket: StorageBucket;
  path: string;
  file: File;
  upsert?: boolean;
}

export interface UploadResult {
  success: boolean;
  path?: string;
  publicUrl?: string;
  error?: string;
}

export interface FileInfo {
  name: string;
  size: number;
  mimeType: string;
  publicUrl: string;
  createdAt: string;
}

// ============================================================================
// 配置
// ============================================================================

const BUCKET_CONFIG: Record<StorageBucket, {
  maxSize: number;
  allowedTypes: string[];
  publicAccess: boolean;
}> = {
  'model-avatars': {
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    publicAccess: true,
  },
  'model-demos': {
    maxSize: 100 * 1024 * 1024, // 100MB
    allowedTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    publicAccess: true,
  },
  'user-uploads': {
    maxSize: 50 * 1024 * 1024, // 50MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'],
    publicAccess: false,
  },
};

// Supabase 项目 URL (从环境变量获取)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 验证文件是否符合 bucket 要求
 */
export function validateFile(file: File, bucket: StorageBucket): { valid: boolean; error?: string } {
  const config = BUCKET_CONFIG[bucket];

  // 检查文件大小
  if (file.size > config.maxSize) {
    const maxSizeMB = config.maxSize / (1024 * 1024);
    return { valid: false, error: `文件大小超过限制 (最大 ${maxSizeMB}MB)` };
  }

  // 检查文件类型
  if (!config.allowedTypes.includes(file.type)) {
    return { valid: false, error: `不支持的文件类型: ${file.type}` };
  }

  return { valid: true };
}

/**
 * 生成唯一文件名
 */
export function generateFileName(originalName: string, prefix?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const extension = originalName.split('.').pop() || '';
  const baseName = prefix || 'file';
  return `${baseName}_${timestamp}_${random}.${extension}`;
}

/**
 * 获取文件的公开 URL
 */
export function getPublicUrl(bucket: StorageBucket, path: string): string {
  if (!SUPABASE_URL) {
    console.warn('SUPABASE_URL not configured');
    return '';
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * 获取文件的签名 URL (用于私有 bucket)
 */
export function getSignedUrl(bucket: StorageBucket, path: string, expiresIn: number = 3600): string {
  // 注意: 这需要在服务端使用 Supabase client 生成
  // 这里返回一个占位符，实际应该通过 API 获取
  return `/api/storage/signed-url?bucket=${bucket}&path=${encodeURIComponent(path)}&expires=${expiresIn}`;
}

// ============================================================================
// Mock 上传函数 (开发环境)
// ============================================================================

/**
 * Mock 上传文件 (开发环境使用)
 * 生产环境应该使用真实的 Supabase Storage API
 */
export async function mockUploadFile(options: UploadOptions): Promise<UploadResult> {
  const { bucket, path, file } = options;

  // 验证文件
  const validation = validateFile(file, bucket);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // 模拟上传延迟
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 模拟成功
  const mockUrl = `https://picsum.photos/seed/${Date.now()}/400/400`;
  
  console.log(`[Mock Storage] Uploaded to ${bucket}/${path}`);

  return {
    success: true,
    path,
    publicUrl: mockUrl,
  };
}

/**
 * Mock 删除文件 (开发环境使用)
 */
export async function mockDeleteFile(bucket: StorageBucket, path: string): Promise<boolean> {
  // 模拟删除延迟
  await new Promise((resolve) => setTimeout(resolve, 500));
  
  console.log(`[Mock Storage] Deleted ${bucket}/${path}`);
  
  return true;
}

// ============================================================================
// 真实上传函数 (需要 Supabase Client)
// ============================================================================

/**
 * 上传文件到 Supabase Storage
 * 
 * 使用方法:
 * ```typescript
 * import { createClient } from '@/lib/supabase/client';
 * import { uploadFile } from '@/lib/storage';
 * 
 * const supabase = createClient();
 * const result = await uploadFile(supabase, {
 *   bucket: 'model-avatars',
 *   path: 'model-001/avatar.jpg',
 *   file: avatarFile,
 * });
 * ```
 */
export async function uploadFile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  options: UploadOptions
): Promise<UploadResult> {
  const { bucket, path, file, upsert = false } = options;

  // 验证文件
  const validation = validateFile(file, bucket);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    // 上传文件
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        cacheControl: '3600',
        upsert,
      });

    if (error) {
      console.error('[Storage] Upload error:', error);
      return { success: false, error: error.message };
    }

    // 获取公开 URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(data.path);

    return {
      success: true,
      path: data.path,
      publicUrl: urlData.publicUrl,
    };
  } catch (err) {
    console.error('[Storage] Unexpected error:', err);
    return { success: false, error: 'Upload failed' };
  }
}

/**
 * 删除文件
 */
export async function deleteFile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  bucket: StorageBucket,
  paths: string[]
): Promise<boolean> {
  try {
    const { error } = await supabase.storage
      .from(bucket)
      .remove(paths);

    if (error) {
      console.error('[Storage] Delete error:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[Storage] Unexpected error:', err);
    return false;
  }
}

/**
 * 列出 bucket 中的文件
 */
export async function listFiles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  bucket: StorageBucket,
  folder?: string
): Promise<FileInfo[]> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(folder || '', {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      });

    if (error) {
      console.error('[Storage] List error:', error);
      return [];
    }

    return data.map((file: { name: string; metadata?: { size?: number; mimetype?: string }; created_at?: string }) => ({
      name: file.name,
      size: file.metadata?.size || 0,
      mimeType: file.metadata?.mimetype || 'unknown',
      publicUrl: getPublicUrl(bucket, folder ? `${folder}/${file.name}` : file.name),
      createdAt: file.created_at || new Date().toISOString(),
    }));
  } catch (err) {
    console.error('[Storage] Unexpected error:', err);
    return [];
  }
}

// ============================================================================
// 导出常量
// ============================================================================

export const STORAGE_BUCKETS = {
  MODEL_AVATARS: 'model-avatars' as StorageBucket,
  MODEL_DEMOS: 'model-demos' as StorageBucket,
  USER_UPLOADS: 'user-uploads' as StorageBucket,
};

export { BUCKET_CONFIG };

