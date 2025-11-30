-- ============================================================================
-- TikTok AI MCN - Storage Buckets 配置
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================================

-- ============================================================================
-- 1. 创建存储桶
-- ============================================================================

-- Model Avatars 存储桶 (公开读取)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'model-avatars',
    'model-avatars',
    true,
    5242880,  -- 5MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Model Demos 存储桶 (公开读取)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'model-demos',
    'model-demos',
    true,
    104857600,  -- 100MB
    ARRAY['video/mp4', 'video/webm', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 104857600,
    allowed_mime_types = ARRAY['video/mp4', 'video/webm', 'video/quicktime'];

-- User Uploads 存储桶 (私有)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'user-uploads',
    'user-uploads',
    false,
    52428800,  -- 50MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];

-- Generated Content 存储桶 (私有)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'generated-content',
    'generated-content',
    false,
    209715200,  -- 200MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 209715200,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];

-- ============================================================================
-- 2. Storage Policies - model-avatars (公开桶)
-- ============================================================================

-- 删除旧策略
DROP POLICY IF EXISTS "Public read access for model avatars" ON storage.objects;
DROP POLICY IF EXISTS "Admin insert access for model avatars" ON storage.objects;
DROP POLICY IF EXISTS "Admin update access for model avatars" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete access for model avatars" ON storage.objects;

-- 公开读取
CREATE POLICY "Public read access for model avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'model-avatars');

-- Admin 可以上传
CREATE POLICY "Admin insert access for model avatars"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'model-avatars' 
    AND EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

-- Admin 可以更新
CREATE POLICY "Admin update access for model avatars"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'model-avatars' 
    AND EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

-- Admin 可以删除
CREATE POLICY "Admin delete access for model avatars"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'model-avatars' 
    AND EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

-- ============================================================================
-- 3. Storage Policies - model-demos (公开桶)
-- ============================================================================

DROP POLICY IF EXISTS "Public read access for model demos" ON storage.objects;
DROP POLICY IF EXISTS "Admin insert access for model demos" ON storage.objects;
DROP POLICY IF EXISTS "Admin update access for model demos" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete access for model demos" ON storage.objects;

CREATE POLICY "Public read access for model demos"
ON storage.objects FOR SELECT
USING (bucket_id = 'model-demos');

CREATE POLICY "Admin insert access for model demos"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'model-demos' 
    AND EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

CREATE POLICY "Admin update access for model demos"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'model-demos' 
    AND EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

CREATE POLICY "Admin delete access for model demos"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'model-demos' 
    AND EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

-- ============================================================================
-- 4. Storage Policies - user-uploads (私有桶)
-- ============================================================================

DROP POLICY IF EXISTS "Users can read own uploads" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own uploads" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own uploads" ON storage.objects;
DROP POLICY IF EXISTS "Admin full access to user uploads" ON storage.objects;

-- 用户可以读取自己的文件
CREATE POLICY "Users can read own uploads"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'user-uploads' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 用户可以上传到自己的文件夹
CREATE POLICY "Users can upload own files"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'user-uploads' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 用户可以更新自己的文件
CREATE POLICY "Users can update own uploads"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'user-uploads' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 用户可以删除自己的文件
CREATE POLICY "Users can delete own uploads"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'user-uploads' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Admin 可以访问所有用户上传
CREATE POLICY "Admin full access to user uploads"
ON storage.objects FOR ALL
USING (
    bucket_id = 'user-uploads' 
    AND EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
);

-- ============================================================================
-- 5. Storage Policies - generated-content (私有桶)
-- ============================================================================

DROP POLICY IF EXISTS "Users can read own generated content" ON storage.objects;
DROP POLICY IF EXISTS "System can create generated content" ON storage.objects;

-- 用户可以读取自己生成的内容
CREATE POLICY "Users can read own generated content"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'generated-content' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 服务端可以创建生成内容 (使用 service_role key)
CREATE POLICY "System can create generated content"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'generated-content');

-- ============================================================================
-- 完成提示
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '✅ Storage 配置完成！';
    RAISE NOTICE '';
    RAISE NOTICE '已创建存储桶：';
    RAISE NOTICE '  - model-avatars (公开, 5MB, 图片)';
    RAISE NOTICE '  - model-demos (公开, 100MB, 视频)';
    RAISE NOTICE '  - user-uploads (私有, 50MB, 图片/视频)';
    RAISE NOTICE '  - generated-content (私有, 200MB, 图片/视频)';
END $$;

