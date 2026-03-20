-- ============================================================================
-- 模板中心 - content_templates + user_template_favorites
-- 系统预设脚本模板（公开，不绑定 user_id）
-- 与已有的 creative_templates（用户私有生产方案）完全独立
-- ============================================================================

-- 1. 创建 content_templates 表
CREATE TABLE IF NOT EXISTS public.content_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN ('ecommerce', 'brand', 'tutorial', 'lifestyle', 'creative', 'engagement')),
  prompt_template text NOT NULL,
  script_outline jsonb DEFAULT '[]'::jsonb,
  style_tags text[] DEFAULT '{}',
  recommended_config jsonb DEFAULT '{}'::jsonb,
  preview_video_url text,
  usage_count integer DEFAULT 0,
  is_featured boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- 2. 创建 user_template_favorites 表
CREATE TABLE IF NOT EXISTS public.user_template_favorites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  template_id uuid REFERENCES public.content_templates(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (user_id, template_id)
);

-- 3. 启用 RLS
ALTER TABLE public.content_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_template_favorites ENABLE ROW LEVEL SECURITY;

-- 4. RLS 策略 - content_templates（系统公开，所有人可读）
-- ⚠️ 使用 true 确保 anon 和 authenticated 角色都能 SELECT
CREATE POLICY "Content templates are publicly readable"
  ON public.content_templates FOR SELECT
  USING (true);

-- 5. RLS 策略 - user_template_favorites（按 user_id 隔离）
CREATE POLICY "Users can view their own favorites"
  ON public.user_template_favorites FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own favorites"
  ON public.user_template_favorites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own favorites"
  ON public.user_template_favorites FOR DELETE
  USING (auth.uid() = user_id);

-- 6. 创建索引
CREATE INDEX IF NOT EXISTS content_templates_category_idx ON public.content_templates(category);
CREATE INDEX IF NOT EXISTS content_templates_is_featured_idx ON public.content_templates(is_featured);
CREATE INDEX IF NOT EXISTS content_templates_sort_order_idx ON public.content_templates(sort_order);
CREATE INDEX IF NOT EXISTS user_template_favorites_user_id_idx ON public.user_template_favorites(user_id);
CREATE INDEX IF NOT EXISTS user_template_favorites_template_id_idx ON public.user_template_favorites(template_id);

-- 7. 插入 16 条种子数据
INSERT INTO public.content_templates (name, description, category, prompt_template, script_outline, style_tags, recommended_config, preview_video_url, usage_count, is_featured, sort_order) VALUES

-- === 电商带货 (ecommerce) ===
(
  '爆款产品展示',
  '适用于单品主推场景，突出产品核心卖点，配合动感节奏展示外观和功能细节。',
  'ecommerce',
  '创作一个15秒的TikTok短视频脚本，展示一款热门产品。开场用吸引眼球的画面（产品特写+灯光效果），中段展示3个核心卖点（功能演示+使用场景），结尾加入行动号召（限时优惠+购买链接）。风格：高级感、快节奏剪辑、配合热门BGM。',
  '["开场：产品特写旋转展示 (0-3s)", "卖点1：核心功能演示 (3-6s)", "卖点2：使用场景展示 (6-9s)", "卖点3：对比效果/数据 (9-12s)", "结尾：价格+限时优惠+CTA (12-15s)"]'::jsonb,
  ARRAY['产品展示', '电商', '快节奏', '高级感'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "veo3", "scene": "产品特写+使用场景"}'::jsonb,
  'https://media.toryxai.com/templates/videos/01_product_showcase.mp4',
  3200, true, 1
),
(
  '开箱测评体验',
  '模拟真实开箱过程，从包装到产品的完整体验，增强用户购买信心。',
  'ecommerce',
  '创作一个开箱测评视频脚本。第一人称视角，从拆快递开始，展示包装细节、配件清单，然后上手体验产品，给出真实感受和评分。语气亲切自然，像朋友推荐一样。结尾引导互动：你觉得值不值？',
  '["开箱：拆快递/展示包装 (0-4s)", "细节：配件+做工特写 (4-8s)", "体验：上手使用感受 (8-12s)", "评分：给出推荐理由 (12-14s)", "互动：提问引导评论 (14-15s)"]'::jsonb,
  ARRAY['开箱', '测评', '第一人称', '真实感'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "sora2", "scene": "开箱+上手体验"}'::jsonb,
  'https://media.toryxai.com/templates/videos/02_unboxing.mp4',
  1800, false, 2
),
(
  '产品对比横评',
  '将两款或多款竞品进行对比测评，帮助用户做购买决策，提升转化率。',
  'ecommerce',
  '创作一个产品对比视频脚本。选择2-3款同类热门产品，从外观、功能、价格三个维度进行对比。使用分屏画面或并排展示，配合数据图表，最后给出推荐选择。风格：客观、专业、有理有据。',
  '["开场：今天对比X款产品 (0-2s)", "外观对比：并排展示 (2-5s)", "功能对比：核心差异 (5-9s)", "价格对比：性价比分析 (9-12s)", "结论：推荐选择+理由 (12-15s)"]'::jsonb,
  ARRAY['对比', '横评', '专业', '数据驱动'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "veo3", "scene": "产品对比+数据图表"}'::jsonb,
  'https://media.toryxai.com/templates/videos/03_product_comparison.mp4',
  950, false, 3
),
(
  '限时秒杀促销',
  '营造紧迫感的促销视频，适用于大促、闪购、清仓等场景，强调时间限制和优惠力度。',
  'ecommerce',
  '创作一个限时秒杀促销视频脚本。开场大字幕"限时X小时"制造紧迫感，快速展示3-5款特价商品，每款1-2秒，配合价格标签和折扣信息。结尾倒计时+购买链接。风格：紧迫、刺激、高能量。',
  '["开场：限时X小时/倒计时 (0-2s)", "商品1：产品+原价→特价 (2-5s)", "商品2：产品+折扣标签 (5-8s)", "商品3：产品+库存预警 (8-11s)", "结尾：最后机会+链接CTA (11-15s)"]'::jsonb,
  ARRAY['秒杀', '促销', '紧迫感', '大促'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "veo3-quality", "scene": "促销氛围+价格标签"}'::jsonb,
  'https://media.toryxai.com/templates/videos/04_flash_sale.mp4',
  2100, true, 4
),

-- === 品牌营销 (brand) ===
(
  '品牌故事讲述',
  '用叙事手法展现品牌价值观和创立故事，建立情感连接，适合品牌推广和形象塑造。',
  'brand',
  '创作一个品牌故事视频脚本。用温暖的叙事语调，讲述品牌从创立到成长的关键时刻。突出品牌使命和价值观，展示团队或创始人，配合品牌视觉元素。结尾传递品牌理念Slogan。风格：温暖、真诚、有深度。',
  '["开场：品牌起源/初心 (0-3s)", "发展：关键里程碑 (3-7s)", "价值：品牌使命展示 (7-10s)", "团队：人物/工匠精神 (10-13s)", "结尾：品牌Slogan+Logo (13-15s)"]'::jsonb,
  ARRAY['品牌故事', '叙事', '情感连接', '高级感'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "sora2-pro", "scene": "品牌视觉+人物故事"}'::jsonb,
  'https://media.toryxai.com/templates/videos/05_brand_story.mp4',
  680, false, 5
),
(
  '用户口碑见证',
  '收集真实用户评价和使用体验，用社会证明的方式增强品牌可信度。',
  'brand',
  '创作一个用户见证视频脚本。收集3-5位真实用户的使用反馈，可以用文字卡片+产品画面的形式呈现。突出具体数据（使用X天后效果提升X%）。结尾展示满意度评分和用户总数。风格：真实、可信、数据化。',
  '["开场：用户好评数量/评分 (0-2s)", "见证1：用户A的反馈+效果 (2-5s)", "见证2：用户B的对比照/数据 (5-8s)", "见证3：用户C的推荐语 (8-11s)", "结尾：总评分+加入我们 (11-15s)"]'::jsonb,
  ARRAY['用户评价', '社会证明', '口碑', '真实'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "sora2", "scene": "用户反馈+数据展示"}'::jsonb,
  'https://media.toryxai.com/templates/videos/06_testimonial.mp4',
  450, false, 6
),

-- === 知识教程 (tutorial) ===
(
  '成就展示激励',
  '展示学习成果、技能提升或成就达成的过程，激励观众行动，适合教育类内容。',
  'tutorial',
  '创作一个成就展示视频脚本。展示从新手到高手的蜕变过程，用before/after对比，配合数据增长图表。突出关键转折点和方法论。结尾引导：你也可以做到。风格：励志、激励、有说服力。',
  '["开场：before状态/起点 (0-3s)", "过程：学习/练习关键节点 (3-7s)", "转折：突破时刻 (7-10s)", "成果：after状态/数据 (10-13s)", "号召：你也可以+方法链接 (13-15s)"]'::jsonb,
  ARRAY['成就', '励志', '蜕变', 'Before/After'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "veo3", "scene": "对比展示+数据图表"}'::jsonb,
  'https://media.toryxai.com/templates/videos/07_achievement.mp4',
  520, false, 7
),
(
  '实用技巧分享',
  '分享某个领域的3-5个实用小技巧，知识密度高，容易获得收藏和转发。',
  'tutorial',
  '创作一个实用技巧视频脚本。主题：X个你不知道的XX技巧。每个技巧用1-2句话说清楚，配合演示画面。技巧要实用、可操作、有惊喜感。结尾引导收藏。风格：干货、高信息密度、易懂。',
  '["开场：X个技巧预告 (0-2s)", "技巧1：操作演示 (2-5s)", "技巧2：操作演示 (5-8s)", "技巧3：操作演示 (8-11s)", "结尾：收藏备用+关注更多 (11-15s)"]'::jsonb,
  ARRAY['技巧', '干货', '教程', '收藏向'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "sora2", "scene": "屏幕录制+操作演示"}'::jsonb,
  'https://media.toryxai.com/templates/videos/08_tips_tricks.mp4',
  1500, true, 8
),
(
  '分步教学指南',
  '手把手教学某个技能或流程，分步骤清晰展示，适合教育和技能培训。',
  'tutorial',
  '创作一个分步教学视频脚本。选择一个可教学的技能/流程，分3-5个步骤详细演示。每步配合字幕标注要点。语速适中，适当暂停让观众跟上。结尾回顾所有步骤。风格：清晰、专业、耐心。',
  '["开场：今天教你XX (0-2s)", "步骤1：具体操作+要点 (2-5s)", "步骤2：具体操作+注意事项 (5-8s)", "步骤3：具体操作+技巧 (8-11s)", "总结：回顾步骤+完成效果 (11-15s)"]'::jsonb,
  ARRAY['教程', '分步', '手把手', '技能'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "veo3", "scene": "教学演示+步骤标注"}'::jsonb,
  'https://media.toryxai.com/templates/videos/09_step_tutorial.mp4',
  870, false, 9
),
(
  '常见问题解答',
  '收集目标受众最关心的问题，逐一解答，既能提供价值又能消除购买疑虑。',
  'tutorial',
  '创作一个FAQ视频脚本。收集3-5个用户最常问的问题，逐一简洁回答。用问答卡片形式呈现，配合相关画面。回答要直接、准确、有案例。结尾引导：还有问题？评论区见。风格：专业、亲切、实用。',
  '["开场：你最想知道的X个问题 (0-2s)", "Q1：问题+简洁回答 (2-5s)", "Q2：问题+数据/案例 (5-8s)", "Q3：问题+专业解答 (8-11s)", "结尾：更多问题→评论区 (11-15s)"]'::jsonb,
  ARRAY['FAQ', '问答', '互动', '专业'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "sora2", "scene": "问答卡片+演示"}'::jsonb,
  'https://media.toryxai.com/templates/videos/10_faq.mp4',
  320, false, 10
),

-- === 生活方式 (lifestyle) ===
(
  '日常生活记录',
  '记录日常生活中的精彩瞬间，展示生活方式和个人态度，轻松有温度。',
  'lifestyle',
  '创作一个日常Vlog视频脚本。记录一天中的3-5个精彩瞬间，从早到晚的时间线叙事。画面治愈、节奏舒缓。配合轻音乐和简短文字旁白。展示生活态度和美学。风格：治愈、文艺、有质感。',
  '["清晨：起床/早餐仪式感 (0-3s)", "上午：工作/学习场景 (3-6s)", "午后：休闲/咖啡时光 (6-9s)", "傍晚：运动/社交 (9-12s)", "夜晚：放松/总结一天 (12-15s)"]'::jsonb,
  ARRAY['Vlog', '日常', '治愈', '生活方式'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "sora2-pro", "scene": "生活场景+情绪氛围"}'::jsonb,
  'https://media.toryxai.com/templates/videos/11_daily_vlog.mp4',
  2800, true, 11
),
(
  '健身运动打卡',
  '展示健身训练过程和成果，激励粉丝一起运动，适合健身和运动品牌推广。',
  'lifestyle',
  '创作一个运动打卡视频脚本。展示一组完整训练流程，每个动作2-3秒，配合次数/组数标注。突出汗水和力量感。结尾展示训练数据和身材变化。风格：热血、激励、高能量。',
  '["开场：训练开始/热身 (0-2s)", "动作1：训练演示+次数 (2-5s)", "动作2：训练演示+技巧 (5-8s)", "动作3：高难度/冲刺 (8-11s)", "结尾：数据总结+坚持打卡 (11-15s)"]'::jsonb,
  ARRAY['健身', '运动', '打卡', '自律'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "veo3", "scene": "健身房+运动场景"}'::jsonb,
  'https://media.toryxai.com/templates/videos/12_fitness.mp4',
  1200, false, 12
),
(
  '美食探店分享',
  '探索和分享美食餐厅或自制美食，展示食物的色香味，引发食欲和兴趣。',
  'lifestyle',
  '创作一个美食分享视频脚本。拍摄食物的特写镜头，展示色泽和质感。加入试吃反应和简短点评。标注餐厅名称/菜品价格。结尾给出推荐评分。风格：诱人、真实、有烟火气。',
  '["开场：餐厅外观/氛围 (0-2s)", "菜品1：特写+试吃反应 (2-5s)", "菜品2：制作过程/细节 (5-8s)", "菜品3：招牌菜展示 (8-11s)", "结尾：评分+推荐指数 (11-15s)"]'::jsonb,
  ARRAY['美食', '探店', '试吃', '种草'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "sora2", "scene": "美食特写+就餐环境"}'::jsonb,
  'https://media.toryxai.com/templates/videos/13_food_review.mp4',
  1650, false, 13
),

-- === 创意内容 (creative) ===
(
  '穿搭风格展示',
  '展示时尚穿搭灵感，换装展示不同风格，适合服装品牌和时尚博主。',
  'creative',
  '创作一个穿搭展示视频脚本。展示3-5套不同场景的穿搭方案（日常/通勤/约会/运动），用快速换装转场。标注每套搭配的单品信息。结尾问观众最喜欢哪套。风格：时尚、自信、有个性。',
  '["开场：今日穿搭灵感 (0-2s)", "Look1：日常休闲搭配 (2-5s)", "Look2：通勤职场搭配 (5-8s)", "Look3：约会精致搭配 (8-11s)", "互动：你Pick哪套？ (11-15s)"]'::jsonb,
  ARRAY['穿搭', '时尚', '换装', 'OOTD'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "sora2-pro", "scene": "镜前换装+街拍"}'::jsonb,
  'https://media.toryxai.com/templates/videos/14_fashion.mp4',
  2400, true, 14
),
(
  '创意图片轮播',
  '将多张精美图片串联成动态视频，适合摄影作品集、产品系列展示。',
  'creative',
  '创作一个图片轮播视频脚本。选择8-12张同主题高质量图片，用Ken Burns效果（缩放+平移）制作动态感。配合节奏感音乐，每张图2-3秒。可加入简短文字说明。风格：精致、艺术、有节奏感。',
  '["开场：主题标题卡 (0-2s)", "图片1-3：缩放平移展示 (2-5s)", "图片4-6：节奏切换 (5-8s)", "图片7-9：高潮加速 (8-11s)", "结尾：品牌/系列名称 (11-15s)"]'::jsonb,
  ARRAY['图片', '轮播', '作品集', '视觉'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "veo3-quality", "scene": "图片素材+动态效果"}'::jsonb,
  'https://media.toryxai.com/templates/videos/15_photo_slideshow.mp4',
  380, false, 15
),

-- === 互动引导 (engagement) ===
(
  '投票互动话题',
  '发起一个有趣的投票或话题讨论，引导用户发表观点，提升互动率和评论量。',
  'engagement',
  '创作一个互动投票视频脚本。提出一个有争议性的二选一话题（A vs B），展示两个选项的图片/视频对比。制造悬念感，引导观众在评论区投票。结尾公布上一期投票结果。风格：有趣、有争议、引发讨论。',
  '["开场：你选A还是B？ (0-2s)", "选项A：展示优势/画面 (2-5s)", "选项B：展示优势/画面 (5-8s)", "对比：关键差异PK (8-11s)", "投票：评论区选1或2 (11-15s)"]'::jsonb,
  ARRAY['互动', '投票', '话题', '评论引导'],
  '{"duration": "15s", "aspect_ratio": "9:16", "model": "sora2", "scene": "对比展示+投票引导"}'::jsonb,
  'https://media.toryxai.com/templates/videos/16_social_poll.mp4',
  760, false, 16
);
