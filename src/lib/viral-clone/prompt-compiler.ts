/**
 * Prompt Compiler — VEO 提示词编译器
 *
 * 职责:
 * 将 SegmentPlan + StyleBible 编译成高质量的 VEO3 视频生成提示词
 *
 * 结构:
 * [镜头类型] [主体动作] [产品/场景描述] [风格指令]
 * [口播内容提示] [音频指令]
 */

import type {
  SegmentPlan,
  SegmentBlueprintV2,
  AnalysisArtifactV2,
  StyleBible,
  SegmentRole,
  AspectRatio,
} from '@/types/viral-clone';

// ============================================================================
// Prompt 模板
// ============================================================================

/** 角色到镜头的映射 */
const ROLE_TO_SHOT: Record<SegmentRole, string> = {
  hook: 'Dynamic opening shot, cinematic close-up',
  body: 'Medium shot, steady camera',
  demo: 'Product close-up, hands-on demonstration',
  proof: 'Before/after comparison, testimonial close-up',
  cta: 'Confident close-up, direct to camera',
  b_roll: 'Smooth B-roll, ambient establishing shot',
};

/** 角色到音频的映射 */
const ROLE_TO_AUDIO: Record<SegmentRole, string> = {
  hook: 'Natural speaking voice with enthusiasm, clear audio',
  body: 'Clear conversational speaking, natural pacing',
  demo: 'Calm explanatory voice, pointing out features',
  proof: 'Confident, testimonial-style speaking',
  cta: 'Energetic, encouraging tone, clear call to action',
  b_roll: 'Ambient sound, no speaking',
};

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 编译单个分段的 VEO 提示词
 *
 * @param segment 分段定义
 * @param styleBible 风格指南
 * @param aspectRatio 画面比例
 * @returns { prompt_en, prompt_zh }
 */
export function compileSegmentPrompt(
  segment: SegmentPlan,
  styleBible: StyleBible,
  aspectRatio: AspectRatio
): { prompt_en: string; prompt_zh: string } {
  const prompt_en = buildEnglishPrompt(segment, styleBible, aspectRatio);
  const prompt_zh = buildChinesePrompt(segment, styleBible, aspectRatio);

  return { prompt_en, prompt_zh };
}

/**
 * 编译整批分段的提示词
 *
 * @param segments 所有分段
 * @param styleBible 风格指南
 * @param aspectRatio 画面比例
 */
export function compileAllPrompts(
  segments: SegmentPlan[],
  styleBible: StyleBible,
  aspectRatio: AspectRatio
): Array<{ prompt_en: string; prompt_zh: string }> {
  return segments.map(segment => compileSegmentPrompt(segment, styleBible, aspectRatio));
}

// ============================================================================
// 内部函数
// ============================================================================

/**
 * 构建英文提示词（VEO 推荐英文）
 */
function buildEnglishPrompt(
  segment: SegmentPlan,
  style: StyleBible,
  aspectRatio: AspectRatio
): string {
  const parts: string[] = [];

  // 1. 镜头类型和朝向
  parts.push(ROLE_TO_SHOT[segment.role]);

  // 2. 画面比例指示
  if (aspectRatio === '9:16') {
    parts.push('vertical portrait composition (9:16)');
  } else {
    parts.push('horizontal landscape composition (16:9)');
  }

  // 3. 主体和产品
  if (style.subject) {
    parts.push(style.subject);
  }
  if (style.product && segment.role !== 'b_roll') {
    parts.push(`showcasing ${style.product}`);
  }

  // 4. 视觉目标
  if (segment.visual_goal) {
    parts.push(segment.visual_goal);
  }

  // 5. 风格指令
  const styleDirectives: string[] = [];
  if (style.color_temp) styleDirectives.push(`${style.color_temp} color temperature`);
  if (style.lighting) styleDirectives.push(style.lighting);
  if (style.camera) styleDirectives.push(style.camera);
  if (style.mood) styleDirectives.push(`${style.mood} mood`);

  if (styleDirectives.length > 0) {
    parts.push(styleDirectives.join(', '));
  }

  // 6. 口播内容和音频（VEO3 支持原生口播音频）
  if (segment.spoken_text && segment.role !== 'b_roll') {
    // 给 VEO 的口播指示 — 保持简洁
    parts.push(`Person speaking to camera: "${segment.spoken_text}"`);
    parts.push(ROLE_TO_AUDIO[segment.role]);
  }

  // 7. 视觉质量
  parts.push('High quality, professional lighting, sharp focus, 4K cinematography');

  return parts.join('. ') + '.';
}

/**
 * 构建中文提示词（备用，某些场景中文效果更好）
 */
function buildChinesePrompt(
  segment: SegmentPlan,
  style: StyleBible,
  aspectRatio: AspectRatio
): string {
  const parts: string[] = [];

  // 1. 镜头类型
  const roleLabels: Record<SegmentRole, string> = {
    hook: '开场动态镜头，电影感特写',
    body: '中景固定镜头',
    demo: '产品特写，实物展示',
    proof: '对比展示，用户证言',
    cta: '自信特写，面对镜头',
    b_roll: '过渡空镜，环境氛围',
  };
  parts.push(roleLabels[segment.role]);

  // 2. 画面比例
  parts.push(aspectRatio === '9:16' ? '竖屏构图' : '横屏构图');

  // 3. 主体
  if (style.subject) parts.push(style.subject);
  if (style.product && segment.role !== 'b_roll') {
    parts.push(`展示${style.product}`);
  }

  // 4. 视觉目标
  if (segment.visual_goal) parts.push(segment.visual_goal);

  // 5. 风格
  if (style.lighting) parts.push(style.lighting);
  if (style.mood) parts.push(`${style.mood}氛围`);

  // 6. 口播
  if (segment.spoken_text && segment.role !== 'b_roll') {
    parts.push(`人物面对镜头说话："${segment.spoken_text}"`);
  }

  // 7. 质量
  parts.push('高画质，专业灯光，清晰对焦');

  return parts.join('，') + '。';
}

// ============================================================================
// V2 Blueprint 编译器
// ============================================================================

/** 角色到描述的映射（V2） */
const ROLE_DESC_V2: Record<string, string> = {
  hook: 'Opening hook segment — grab attention immediately',
  demo: 'Product demonstration — show the product in action',
  proof: 'Social proof / results — show before/after or testimonial',
  cta: 'Call to action — confident close, encourage purchase',
  b_roll: 'B-roll transition — ambient establishing shot',
};

/** 角色到音频指令的映射（V2） */
const ROLE_AUDIO_V2: Record<string, string> = {
  hook: 'Enthusiastic, attention-grabbing speaking voice with clear audio',
  demo: 'Calm, explanatory tone, showing product features',
  proof: 'Confident, testimonial-style speaking',
  cta: 'Energetic, encouraging tone with clear call to action',
  b_roll: 'Ambient background sound, no speaking',
};

/**
 * V2: 从 SegmentBlueprintV2 编译完整的 VEO prompt
 *
 * 不截断台词，不用模板文本，全量基于真实分析结果。
 */
export function compileBlueprintPrompt(
  blueprint: SegmentBlueprintV2,
  styleBible: StyleBible,
  analysis: AnalysisArtifactV2,
  aspectRatio: AspectRatio
): string {
  const parts: string[] = [];

  // 1. 段落角色和时长
  parts.push(ROLE_DESC_V2[blueprint.role] || `Segment: ${blueprint.role}`);
  parts.push(`Duration: ${blueprint.generation_duration_seconds}s`);

  // 1b. 如果源跨度和生成时长不同，提示模型需要压缩内容
  if (blueprint.source_span_seconds > blueprint.generation_duration_seconds) {
    parts.push(
      `Cover the key content from source range ${blueprint.source_start_s}s-${blueprint.source_end_s}s in a single ${blueprint.generation_duration_seconds}s clip`
    );
  }

  // 2. 画面比例
  parts.push(aspectRatio === '9:16'
    ? 'Vertical portrait composition (9:16)'
    : 'Horizontal landscape composition (16:9)');

  // 3. 主体和颜色风格
  if (styleBible.subject) parts.push(styleBible.subject);
  if (styleBible.product && blueprint.role !== 'b_roll') {
    parts.push(`showcasing ${styleBible.product}`);
  }

  // 4. 画面描述 — 优先使用细化后的描述，回退到全局 visual beats
  if (blueprint.visual_description) {
    parts.push(`Scene: ${blueprint.visual_description}`);
  } else {
    const matchedBeats = analysis.visual_beats.filter(b =>
      blueprint.beat_ids.includes(b.id)
    );
    if (matchedBeats.length > 0) {
      parts.push('Visual beats:');
      matchedBeats.forEach(beat => {
        const timeRange = `${beat.approx_start_s}s-${beat.approx_end_s}s`;
        parts.push(`${timeRange}: ${beat.description}`);
      });
    }
  }

  // 4b. 镜头运动
  if (blueprint.camera) {
    parts.push(`Camera: ${blueprint.camera}`);
  } else if (styleBible.camera) {
    parts.push(`Camera: ${styleBible.camera}`);
  }

  // 5. 口播内容（全文，不截断）
  const spokenText = blueprint.spoken_text_for_generation || blueprint.spoken_text_exact;
  if (spokenText && blueprint.role !== 'b_roll') {
    parts.push(`Person speaking to camera: "${spokenText}"`);
    parts.push(ROLE_AUDIO_V2[blueprint.role] || 'Clear speaking voice');
  }

  // 6. 必须保留的元素
  if (blueprint.key_elements.length > 0) {
    parts.push(`Must keep: ${blueprint.key_elements.join(', ')}`);
  }

  // 7. 风格指令
  const styleDirectives: string[] = [];
  if (styleBible.color_temp) styleDirectives.push(`${styleBible.color_temp} color temperature`);
  if (styleBible.lighting) styleDirectives.push(styleBible.lighting);
  if (styleBible.mood) styleDirectives.push(`${styleBible.mood} mood`);
  if (styleDirectives.length > 0) {
    parts.push(`Style: ${styleDirectives.join(', ')}`);
  }

  // 8. 衔接提示
  if (blueprint.seam_hint === 'start_of_video') {
    parts.push('This is the opening of the video');
  } else if (blueprint.seam_hint === 'end_of_video') {
    parts.push('End with product visible in frame, natural conclusion');
  } else {
    parts.push('Maintain continuity with adjacent segments');
  }

  // 9. 质量指令
  parts.push('High quality, professional lighting, sharp focus, 4K cinematography');

  return parts.join('. ') + '.';
}
