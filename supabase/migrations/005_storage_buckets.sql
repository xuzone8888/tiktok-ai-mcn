-- ============================================================================
-- Migration: 005_storage_buckets.sql
-- Description: 创建 Supabase Storage Buckets 和访问策略
-- 
-- Buckets:
--   - model-avatars: 模特头像图片 (jpg, png, webp)
--   - model-demos: 模特展示视频 (mp4, webm)
-- 
-- 策略:
--   - 公开读取: 所有用户可访问
--   - Admin 写入: 仅 Admin/Super Admin 可上传/更新/删除
-- ============================================================================

-- ============================================================================
-- 1. 创建 Storage Buckets
-- ============================================================================

-- 创建 model-avatars bucket (公开)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'model-avatars',
  'model-avatars',
  true,  -- 公开访问
  5242880,  -- 5MB 限制
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 创建 model-demos bucket (公开)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'model-demos',
  'model-demos',
  true,  -- 公开访问
  104857600,  -- 100MB 限制 (视频文件较大)
  ARRAY['video/mp4', 'video/webm', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- 2. 辅助函数: 获取当前用户角色
-- ============================================================================

-- 确保 get_user_role 函数存在 (如果已存在则跳过)
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role::TEXT INTO user_role
  FROM public.users
  WHERE id = auth.uid();
  
  RETURN COALESCE(user_role, 'anonymous');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- 3. model-avatars Bucket 存储策略
-- ============================================================================

-- 3.1 公开读取策略 (所有人可读)
DROP POLICY IF EXISTS "Public can view model avatars" ON storage.objects;
CREATE POLICY "Public can view model avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'model-avatars');

-- 3.2 Admin 上传策略
DROP POLICY IF EXISTS "Admins can upload model avatars" ON storage.objects;
CREATE POLICY "Admins can upload model avatars"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'model-avatars'
  AND (
    public.get_user_role() = 'admin'
    OR public.get_user_role() = 'super_admin'
  )
);

-- 3.3 Admin 更新策略
DROP POLICY IF EXISTS "Admins can update model avatars" ON storage.objects;
CREATE POLICY "Admins can update model avatars"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'model-avatars'
  AND (
    public.get_user_role() = 'admin'
    OR public.get_user_role() = 'super_admin'
  )
);

-- 3.4 Admin 删除策略
DROP POLICY IF EXISTS "Admins can delete model avatars" ON storage.objects;
CREATE POLICY "Admins can delete model avatars"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'model-avatars'
  AND (
    public.get_user_role() = 'admin'
    OR public.get_user_role() = 'super_admin'
  )
);

-- ============================================================================
-- 4. model-demos Bucket 存储策略
-- ============================================================================

-- 4.1 公开读取策略 (所有人可读)
DROP POLICY IF EXISTS "Public can view model demos" ON storage.objects;
CREATE POLICY "Public can view model demos"
ON storage.objects FOR SELECT
USING (bucket_id = 'model-demos');

-- 4.2 Admin 上传策略
DROP POLICY IF EXISTS "Admins can upload model demos" ON storage.objects;
CREATE POLICY "Admins can upload model demos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'model-demos'
  AND (
    public.get_user_role() = 'admin'
    OR public.get_user_role() = 'super_admin'
  )
);

-- 4.3 Admin 更新策略
DROP POLICY IF EXISTS "Admins can update model demos" ON storage.objects;
CREATE POLICY "Admins can update model demos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'model-demos'
  AND (
    public.get_user_role() = 'admin'
    OR public.get_user_role() = 'super_admin'
  )
);

-- 4.4 Admin 删除策略
DROP POLICY IF EXISTS "Admins can delete model demos" ON storage.objects;
CREATE POLICY "Admins can delete model demos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'model-demos'
  AND (
    public.get_user_role() = 'admin'
    OR public.get_user_role() = 'super_admin'
  )
);

-- ============================================================================
-- 5. 可选: 创建 user-uploads bucket (用户上传的素材)
-- ============================================================================

-- 创建 user-uploads bucket (私有，用户只能访问自己的文件)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-uploads',
  'user-uploads',
  false,  -- 私有
  52428800,  -- 50MB 限制
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 5.1 用户只能查看自己的文件
DROP POLICY IF EXISTS "Users can view own uploads" ON storage.objects;
CREATE POLICY "Users can view own uploads"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'user-uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 5.2 用户只能上传到自己的文件夹
DROP POLICY IF EXISTS "Users can upload to own folder" ON storage.objects;
CREATE POLICY "Users can upload to own folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'user-uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 5.3 用户只能更新自己的文件
DROP POLICY IF EXISTS "Users can update own uploads" ON storage.objects;
CREATE POLICY "Users can update own uploads"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'user-uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 5.4 用户只能删除自己的文件
DROP POLICY IF EXISTS "Users can delete own uploads" ON storage.objects;
CREATE POLICY "Users can delete own uploads"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'user-uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 5.5 Admin 可以访问所有用户上传的文件
DROP POLICY IF EXISTS "Admins can manage all user uploads" ON storage.objects;
CREATE POLICY "Admins can manage all user uploads"
ON storage.objects FOR ALL
USING (
  bucket_id = 'user-uploads'
  AND (
    public.get_user_role() = 'admin'
    OR public.get_user_role() = 'super_admin'
  )
);

-- ============================================================================
-- 6. 验证 (可选 - 用于测试)
-- ============================================================================

-- 查看已创建的 buckets
-- SELECT * FROM storage.buckets;

-- 查看 storage 策略
-- SELECT * FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';

