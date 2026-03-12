#!/usr/bin/env python3
"""
FFmpeg 图片轮播视频生成脚本
功能: 将多张图片合成为带转场效果和背景音乐的视频
"""

import os
import sys
import json
import uuid
import shutil
import subprocess
import tempfile
from pathlib import Path
from PIL import Image
import argparse
import random

# 配置 - 使用项目目录下的 .temp 文件夹，避免 Windows 中文用户名路径编码问题
# 注: 通过 os.getcwd() 获取调用时的工作目录 (应该是项目根目录)
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
TEMP_DIR = PROJECT_DIR / ".temp" / "slideshow"
OUTPUT_DIR = PROJECT_DIR / ".temp" / "slideshow" / "output"

# 分辨率配置
RESOLUTIONS = {
    "9:16": (1080, 1920),  # 竖版
    "16:9": (1920, 1080),  # 横版
}

# 每张图片默认显示时长(秒)
DEFAULT_DURATION = 2

# ========================================
# 🎬 字体检测 + 动画标签生成
# ========================================

# 字体查找映射表：fontFamily ID → 可能的字体文件路径（按优先级排列）
FONT_LOOKUP = {
    'NotoSansSC': [
        str(PROJECT_DIR / 'public' / 'fonts' / 'NotoSansSC' / 'NotoSansSC-Variable.ttf'),
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',  # Linux apt
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    ],
    'ZCOOLKuaiLe': [
        str(PROJECT_DIR / 'public' / 'fonts' / 'ZCOOLKuaiLe' / 'ZCOOLKuaiLe-Regular.ttf'),
    ],
    'Montserrat': [
        str(PROJECT_DIR / 'public' / 'fonts' / 'Montserrat' / 'Montserrat-Bold.ttf'),
    ],
    'BebasNeue': [
        str(PROJECT_DIR / 'public' / 'fonts' / 'BebasNeue' / 'BebasNeue-Regular.ttf'),
    ],
    'Pacifico': [
        str(PROJECT_DIR / 'public' / 'fonts' / 'Pacifico' / 'Pacifico-Regular.ttf'),
    ],
    'Cinzel': [
        str(PROJECT_DIR / 'public' / 'fonts' / 'Cinzel' / 'Cinzel-VariableFont_wght.ttf'),
    ],
    'EBGaramond': [
        str(PROJECT_DIR / 'public' / 'fonts' / 'EB_Garamond' / 'EBGaramond-VariableFont_wght.ttf'),
    ],
    'MicrosoftYaHei': [
        'C:/Windows/Fonts/msyh.ttc',
    ],
}

# ASS 内嵌字体名映射（ASS 使用字体的内部名称，不是文件名）
FONT_ASS_NAMES = {
    'NotoSansSC': 'Noto Sans SC',
    'ZCOOLKuaiLe': 'ZCOOL KuaiLe',
    'Montserrat': 'Montserrat',
    'BebasNeue': 'Bebas Neue',
    'Pacifico': 'Pacifico',
    'Cinzel': 'Cinzel',
    'EBGaramond': 'EB Garamond',
    'MicrosoftYaHei': 'Microsoft YaHei',
}

# 默认字体回退顺序（中文优先）
DEFAULT_FONT_FALLBACK = ['NotoSansSC', 'MicrosoftYaHei', 'Montserrat']


def detect_available_font(font_family_id: str = '') -> str:
    """
    动态检测可用字体，返回 ASS Fontname
    优先使用用户指定的字体，若不可用则按回退顺序查找
    """
    # 尝试指定字体
    if font_family_id and font_family_id in FONT_LOOKUP:
        for path in FONT_LOOKUP[font_family_id]:
            if os.path.exists(path):
                print(f"[Font] Found: {font_family_id} at {path}")
                return FONT_ASS_NAMES.get(font_family_id, font_family_id)
        print(f"[Font] Requested '{font_family_id}' not found, trying fallback...")

    # 回退查找
    for fb_id in DEFAULT_FONT_FALLBACK:
        for path in FONT_LOOKUP.get(fb_id, []):
            if os.path.exists(path):
                print(f"[Font] Fallback: {fb_id} at {path}")
                return FONT_ASS_NAMES.get(fb_id, fb_id)

    # 最终回退
    print("[Font] WARNING: No fonts found, using Microsoft YaHei (may fail on Linux)")
    return 'Microsoft YaHei'


def get_font_dir_for_ass() -> str:
    """获取 ASS fontsdir 路径（包含项目字体）"""
    project_fonts = str(PROJECT_DIR / 'public' / 'fonts')
    if os.path.isdir(project_fonts):
        return project_fonts
    return 'C:/Windows/Fonts'


def build_animation_tags(animation: str, pos_x: int = 0, pos_y: int = 0, is_trending: bool = False) -> str:
    """
    根据动画预设生成 ASS override tags
    
    所有动画都设计为不依赖 pos_x/pos_y 坐标，使用纯 transform 实现
    适用于 alignment 定位的配音字幕（无 \pos() 标签）
    
    Args:
        animation: 动画类型 'none' | 'fade' | 'pop' | 'slide-up' | 'slide-left' | 'glow'
        pos_x: 保留参数（向后兼容）
        pos_y: 保留参数（向后兼容）
        is_trending: 是否潮流样式 — True 时用 \1a 替代 \alpha，避免覆盖 \3a\4a 底色透明度
    Returns:
        ASS override tag 字符串
    """
    if not animation or animation == 'none':
        return ''
    
    # ⭐ 潮流样式：用 \1a（仅文字alpha）替代 \alpha（全alpha），避免覆盖底色 \3a\4a
    a_full = r'\1a' if is_trending else r'\alpha'
    
    if animation == 'fade':
        # 淡入 300ms，淡出 200ms — 简洁经典
        return r'{\fad(300,200)}'
    
    elif animation == 'pop':
        # 弹出：透明+50%高度 → 105%回弹 → 100%
        return '{' + f'{a_full}&HFF&' + r'\fscy50' + r'\t(0,200,' + f'{a_full}&H00&' + r'\fscy105)' + r'\t(200,350,\fscy100)}'
    
    elif animation == 'slide-up':
        # 从下方滑入
        return r'{\fscy0\fad(200,200)\t(0,300,\fscy100)}'
    
    elif animation == 'slide-left':
        # 展开：透明渐显+淡出
        return '{' + f'{a_full}&HFF&' + r'\t(0,300,' + f'{a_full}&H00&)' + r'\fad(0,200)}'
    
    elif animation == 'glow':
        # 发光脉冲：blur + fad
        return r'{\blur8\t(0,400,\blur0)\t(400,800,\blur3)\t(800,1000,\blur0)\fad(200,200)}'
    
    else:
        print(f"[Animation] Unknown animation type: {animation}")
        return ''


def ensure_dirs():
    """确保临时目录存在"""
    os.makedirs(TEMP_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)


def resize_image(input_path: str, output_path: str, target_size: tuple):
    """
    将图片调整为目标尺寸，保持比例，填充黑色背景
    """
    with Image.open(input_path) as img:
        # 转换为 RGB (处理 RGBA 或其他模式)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        target_w, target_h = target_size
        img_w, img_h = img.size
        
        # 计算缩放比例
        scale = min(target_w / img_w, target_h / img_h)
        new_w = int(img_w * scale)
        new_h = int(img_h * scale)
        
        # 缩放图片
        img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
        # 创建黑色背景
        background = Image.new('RGB', target_size, (0, 0, 0))
        
        # 居中粘贴
        offset_x = (target_w - new_w) // 2
        offset_y = (target_h - new_h) // 2
        background.paste(img_resized, (offset_x, offset_y))
        
        # 保存
        background.save(output_path, 'JPEG', quality=95)


def generate_slideshow(
    images: list,
    output_path: str,
    aspect_ratio: str = "9:16",
    duration_per_image: float = 2.0,
    transition: str = "fade",
    music_path: str = None,
    subtitle: dict = None,  # {text, position, fontSize, fontColor, voiceDuration}
):
    """
    生成轮播视频
    
    Args:
        images: 图片路径列表
        output_path: 输出视频路径
        aspect_ratio: 视频比例 "9:16" 或 "16:9"
        duration_per_image: 每张图片显示时长(秒)
        transition: 转场效果 "none", "fade", "slide"
        music_path: 背景音乐路径(可选)
        subtitle: 字幕配置，包含 voiceDuration 用于时长调整
    
    Returns:
        bool: 是否成功
    """
    if not images:
        print("Error: No images provided")
        return False
    
    # 智能调整视频时长：确保配音能完整播放
    # 配音延迟 1 秒 + 配音时长 + 0.5 秒缓冲
    VOICE_DELAY = 1.0
    VOICE_BUFFER = 0.5
    n = len(images)
    fade_duration = 0.5  # 转场时长
    
    # 计算原始视频时长
    if transition == "none":
        original_video_duration = n * duration_per_image
    else:
        # 有转场时，总时长 = n * duration - (n-1) * fade
        original_video_duration = n * duration_per_image - (n - 1) * fade_duration
    
    # 检查配音时长
    voice_duration = subtitle.get('voiceDuration', 0) if subtitle else 0
    if voice_duration > 0:
        required_duration = VOICE_DELAY + voice_duration + VOICE_BUFFER
        
        if required_duration > original_video_duration:
            # 需要延长视频时长
            extra_time = required_duration - original_video_duration
            # 平均分配到每张图片
            extra_per_image = extra_time / n
            new_duration = duration_per_image + extra_per_image
            print(f"[Slideshow] Adjusting video duration for voiceover:")
            print(f"[Slideshow]   Original: {original_video_duration:.1f}s ({n} images × {duration_per_image}s)")
            print(f"[Slideshow]   Required: {required_duration:.1f}s (voice: {voice_duration:.1f}s + delay: {VOICE_DELAY}s + buffer: {VOICE_BUFFER}s)")
            print(f"[Slideshow]   New duration per image: {new_duration:.1f}s (+{extra_per_image:.1f}s)")
            duration_per_image = new_duration
        else:
            print(f"[Slideshow] Video duration OK: {original_video_duration:.1f}s >= {required_duration:.1f}s (voice: {voice_duration:.1f}s)")
    
    task_id = str(uuid.uuid4())[:8]
    work_dir = os.path.join(TEMP_DIR, task_id)
    os.makedirs(work_dir, exist_ok=True)
    
    try:
        target_size = RESOLUTIONS.get(aspect_ratio, RESOLUTIONS["9:16"])
        
        # Step 1: 预处理图片
        processed_images = []
        for i, img_path in enumerate(images):
            output_img = os.path.join(work_dir, f"img_{i:04d}.jpg")
            resize_image(img_path, output_img, target_size)
            processed_images.append(output_img)
        
        # 🎬 注入运行时参数到 subtitle 配置，供下游函数使用
        if subtitle:
            subtitle['_aspect_ratio'] = aspect_ratio
            # 🔧 关键修复：注入（可能被配音延长后的）实际 duration_per_image
            # 否则 overlay 时间轴会使用默认值 2.0，导致所有 overlay 挤在第一张图上
            subtitle['durationPerImage'] = duration_per_image
        
        # Step 2: 构建 FFmpeg 命令
        if transition == "none":
            # 无转场: 简单拼接
            cmd = build_simple_slideshow_cmd(
                processed_images, output_path, duration_per_image, music_path, subtitle, work_dir
            )
        else:
            # 使用转场效果 - 支持多种 xfade 效果
            cmd = build_fade_slideshow_cmd(
                processed_images, output_path, duration_per_image, music_path, subtitle, transition, work_dir
            )
        
        # Step 3: 执行 FFmpeg
        print(f"Running FFmpeg: {' '.join(cmd[:10])}...")
        # Windows 兼容: 不使用 text=True，手动解码以避免编码错误
        result = subprocess.run(cmd, capture_output=True)
        
        if result.returncode != 0:
            # 尝试解码 stderr，忽略无法解码的字符
            stderr = result.stderr.decode('utf-8', errors='ignore') if result.stderr else ''
            print(f"FFmpeg error (return code {result.returncode}): {stderr[:1000]}")
            return False
        
        # 检查输出文件是否存在
        if not os.path.exists(output_path):
            print(f"Error: Output file not created: {output_path}")
            return False
        
        print(f"Video generated: {output_path}")
        return True
        
    finally:
        # 清理临时文件
        shutil.rmtree(work_dir, ignore_errors=True)


def generate_ass_subtitle(text: str, font_size: int, font_color: str, subtitle: dict, aspect_ratio: str = '9:16') -> str:
    """
    生成 ASS 格式字幕文件内容 - 支持分句显示 + 动画效果
    将完整文案拆分成多个句子，每句依次显示，与配音同步
    支持新的方框定位参数: boxX, boxY, boxWidth
    """
    import re
    
    # 解析颜色 (ASS 使用 &HBBGGRR 格式)
    def hex_to_ass_color(hex_color: str) -> str:
        """将 #RRGGBB 转换为 ASS 的 &HBBGGRR 格式"""
        if hex_color.startswith('#'):
            hex_color = hex_color[1:]
        if len(hex_color) == 6:
            r, g, b = hex_color[0:2], hex_color[2:4], hex_color[4:6]
            return f"&H00{b}{g}{r}"
        return "&H00FFFFFF"  # 默认白色
    
    primary_color = hex_to_ass_color(font_color)
    
    # 检查样式 - 每种样式有完全不同的 ASS 参数
    style_name = subtitle.get('style', 'classic')
    is_neon = style_name == 'neon'
    is_trending = style_name == 'trending'
    
    # 读取前端的字重设置 (fontWeight 可能是 '400', '600', '700' 等字符串)
    font_weight_str = subtitle.get('fontWeight', '400')
    try:
        font_weight = int(font_weight_str) if font_weight_str else 400
    except (ValueError, TypeError):
        font_weight = 400
    
    # 字重 >= 600 视为粗体
    is_bold = font_weight >= 600
    bold = 1 if is_bold else 0
    
    # ============================================================
    # 五种样式的 ASS 专用参数（经 15 方案迭代验证的最优参数）
    # ============================================================
    # 默认 BorderStyle=1 (普通描边)
    border_style = 1
    spacing = 0  # 字间距
    
    if style_name == 'classic':
        # 📺 经典 C4 深阴影: bord=4 + shadow=3，立体浮雕感
        outline_color = "&H00000000"  # 黑色描边
        border_width = 4
        shadow_depth = 3
        back_color = "&H90000000"  # 深半透明阴影色
        bold = 1  # 强制粗体
    elif style_name == 'trending':
        # 🔥 潮流: BorderStyle=3 方框背景模式
        # 透明度由 Dialogue 行的 \3a/\4a 覆盖标签控制（比 Style 行 alpha 更可靠）
        border_style = 3
        outline_color = "&H00000000"  # 纯黑色（透明度由 Dialogue \3a 控制）
        border_width = 0
        shadow_depth = 0
        back_color = "&H00000000"  # 纯黑色（透明度由 Dialogue \4a 控制）
        bold = 1
    elif style_name == 'cinema':
        # 🎬 影视 M3 细黑宽距: bord=1 + Spacing=4，电影字幕感
        outline_color = "&H00000000"  # 细黑描边
        border_width = 1
        shadow_depth = 2
        back_color = "&H60000000"
        spacing = 4  # 宽字间距是关键差异
        bold = 0  # 非粗体更优雅
    elif style_name == 'neon':
        # 💜 霓虹 B方案: Outline=2 blur=3 青色光晕
        # 底层光晕（GlowLayer）在 Style 行单独生成
        # 顶层描边色跟随色调（深色描边增加可读性）
        tone = subtitle.get('tone', 'cool')
        outline_color = "&H00804000" if tone == 'cool' else "&H00000044" if tone == 'warm' else "&H00333333"
        border_width = 2  # 与 GlowLayer 匹配，避免定位偏移
        shadow_depth = 0
        back_color = "&H00000000"
        bold = 1
    elif style_name == 'minimal':
        # ✏️ 简约 N4 极淡阴影: bord=0 + shadow=1，干净且可读
        outline_color = "&H00000000"
        border_width = 0
        shadow_depth = 1
        back_color = "&HC0000000"  # 深透明阴影
        bold = 0  # 常规字重
    else:
        # 未知样式回退到 classic
        outline_color = "&H00000000"
        border_width = 4
        shadow_depth = 3
        back_color = "&H90000000"
        bold = 1
    
    print(f"[Subtitle] Style: {style_name}, fontWeight: {font_weight_str} -> bold={bold}, bord={border_width}, shadow={shadow_depth}, borderStyle={border_style}")
    
    # 方框定位参数 (新版)
    box_x = subtitle.get('boxX', 10)  # 左边距百分比
    box_y = subtitle.get('boxY', 70)  # 上边距百分比
    box_width = subtitle.get('boxWidth', 80)  # 宽度百分比
    
    # 兼容旧版 position 参数
    position = subtitle.get('position', box_y)
    
    # === Bug Fix: 根据实际宽高比设置分辨率 ===
    if aspect_ratio == '16:9':
        video_width = 1920
        video_height = 1080
    else:  # 9:16 默认
        video_width = 1080
        video_height = 1920
    
    # 计算 ASS 边距
    margin_l = int(video_width * box_x / 100)
    margin_r = int(video_width * (100 - box_x - box_width) / 100)
    margin_v = int(video_height * (100 - position) / 100)
    
    # 字号缩放: 预览区字号 -> 实际视频字号
    PREVIEW_HEIGHT = subtitle.get('_previewHeight', 520)  # 前端传入实际预览区高度
    scale_factor = video_height / PREVIEW_HEIGHT
    
    # 计算实际视频字号
    scaled_font_size = int(font_size * scale_factor)
    # 影视(cinema)样式用细体(bold=0)，视频中显得偏小偏细，补偿放大 15%
    if style_name == 'cinema':
        scaled_font_size = int(scaled_font_size * 1.15)
    actual_font_size = max(48, min(360, scaled_font_size))
    
    print(f"[Subtitle] Font scaling: preview {font_size}px * {scale_factor:.2f} = video {actual_font_size}px")
    print(f"[Subtitle] Video resolution: {video_width}x{video_height} ({aspect_ratio})")
    
    # === 动态字体检测 ===
    font_family_id = subtitle.get('fontFamily', '')
    font_name = detect_available_font(font_family_id)
    print(f"[Subtitle] Font: requested='{font_family_id}' -> detected='{font_name}'")
    
    alignment = 2  # 底部居中
    
    # 配音延迟 - 与 TypeScript 中的 VOICE_DELAY_MS 保持一致
    # 预览模式不需要延迟（只捕获第 0 帧）
    is_preview = subtitle.get('_preview_mode', False)
    VOICE_DELAY_SECONDS = 0.0 if is_preview else 1.0
    SYNC_BUFFER = 0.5
    
    # 格式化 ASS 时间 (H:MM:SS.CC)
    def format_ass_time(seconds: float) -> str:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = seconds % 60
        return f"{hours}:{minutes:02d}:{secs:05.2f}"
    
    # 拆分句子的函数
    def split_sentences(text: str) -> list:
        """Split text into subtitle segments. Each segment max 2 lines via backslash-N."""
        # Dynamic max chars per line
        available_width = video_width - margin_l - margin_r
        # 判断文本语言：中文每字约 font_size * 0.78px（全角），英文每字约 font_size * 0.50px（半角平均）
        chinese_ratio = len(re.findall(r'[\u4e00-\u9fff]', text)) / max(len(text), 1)
        char_width_est = actual_font_size * (0.78 if chinese_ratio > 0.3 else 0.50)
        max_line_chars = max(6, int(available_width / char_width_est) - 1)
        print(f"[Subtitle] max_line_chars={max_line_chars} (avail={available_width}px, font={actual_font_size}px)")
        
        # Step 1: Split by sentence-ending punctuation
        segments = re.split(r'(?<=[。！？.!?])\s*', text)
        segments = [s.strip() for s in segments if s.strip()]
        
        # Step 2: Further split long sentences by commas
        result = []
        for seg in segments:
            if len(seg) <= max_line_chars * 2:
                result.append(seg)
            else:
                sub = re.split(r'(?<=[，,、;；])\s*', seg)
                sub = [s.strip() for s in sub if s.strip()]
                if len(sub) > 1:
                    # Group comma-sub-segments into pairs that fit 2 lines
                    current = ""
                    for s in sub:
                        if current and len(current) + len(s) > max_line_chars * 2:
                            result.append(current)
                            current = s
                        else:
                            current = current + s if current else s
                    if current:
                        result.append(current)
                else:
                    result.append(seg)
        
        # Step 3: Wrap each segment into multiple lines (each line <= max_line_chars)
        final = []
        for seg in result:
            if len(seg) <= max_line_chars:
                final.append(seg)
                continue
            
            chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', seg))
            is_chinese = chinese_chars > len(seg) * 0.3
            
            if is_chinese:
                # Split into lines of max_line_chars, prefer breaking at commas
                sub_lines = []
                current = ""
                for char in seg:
                    current += char
                    if char in '，,、；：' and len(current) >= 4:
                        sub_lines.append(current)
                        current = ""
                    elif len(current) >= max_line_chars:
                        sub_lines.append(current)
                        current = ""
                if current:
                    if sub_lines and len(current) <= 3 and len(sub_lines[-1]) + len(current) <= max_line_chars:
                        sub_lines[-1] = sub_lines[-1] + current
                    else:
                        sub_lines.append(current)
                wrapped = (chr(92) + 'N').join(sub_lines)
                final.append(wrapped)
            else:
                # English: wrap at spaces
                words = seg.split()
                sub_lines = []
                current_line = ""
                for word in words:
                    test = current_line + (" " if current_line else "") + word
                    if len(test) <= max_line_chars:
                        current_line = test
                    else:
                        if current_line:
                            sub_lines.append(current_line)
                        current_line = word
                if current_line:
                    sub_lines.append(current_line)
                wrapped = (chr(92) + 'N').join(sub_lines)
                final.append(wrapped)
        
        out = final if final else [text]
        for idx, seg in enumerate(out):
            clean = seg.replace(chr(92)+'N', '')
            print(f"[Subtitle] split_sentences[{idx}] ({len(clean)}ch): {clean}")
        return out
    
    # 检查是否有精确的词级时间戳
    word_timestamps = subtitle.get('wordTimestamps', [])
    
    if word_timestamps and len(word_timestamps) > 0:
        # 使用精确词级时间戳生成字幕（最佳效果）
        print(f"[Subtitle] Using precise word timestamps: {len(word_timestamps)} words")
        
        # 将词按组分组显示（每组 4-6 个词，避免屏幕上显示太多文字）
        max_words_per_group = 5
        dialogues = []
        
        i = 0
        while i < len(word_timestamps):
            # 取一组词
            group_end = min(i + max_words_per_group, len(word_timestamps))
            group = word_timestamps[i:group_end]
            
            # 获取这组词的开始和结束时间
            group_start = group[0]['start']
            group_end_time = group[-1]['end']
            
            # 拼接这组词的文本（清理换行符防止破坏 ASS Dialogue 单行格式）
            group_text = ' '.join([w['word'].replace('\n', '').replace('\r', '') for w in group])
            
            # 不再手动 \N 换行——WrapStyle:0 + margins 让 libass 在空格处自动换行
            
            # 添加延迟
            adjusted_start = VOICE_DELAY_SECONDS + group_start
            adjusted_end = VOICE_DELAY_SECONDS + group_end_time
            
            # 🎬 动画标签注入（预览模式跳过，因为 time=0 时 fad 使字幕透明）
            animation = subtitle.get('animation', 'fade')  # 默认淡入淡出
            anim_tags = '' if is_preview else build_animation_tags(animation, is_trending=is_trending)
            
            # 霓虹双层渲染：生成两条 Dialogue（底层光晕 Layer 0 + 顶层清晰文字 Layer 1）
            if is_neon:
                blur_tag = '{' + chr(92) + 'blur2}'  # blur2: 与 overlay 一致，清晰光晕
                glow_dialogue = f"Dialogue: 0,{format_ass_time(adjusted_start)},{format_ass_time(adjusted_end)},GlowLayer,,0,0,0,,{blur_tag}{anim_tags}{group_text}"
                dialogues.append(glow_dialogue)
            
            # 潮流: xbord/ybord 控制内边距, \3a/\4a 控制半透明度
            trending_tag = r'{\xbord8\ybord4\3a&HA0&\4a&HA0&}' if is_trending else ''  # A0=63% 透明（与 overlay 一致）
            
            # 霓虹时 Default 直接用 Layer 1
            default_layer = 1 if is_neon else 0
            dialogue = f"Dialogue: {default_layer},{format_ass_time(adjusted_start)},{format_ass_time(adjusted_end)},Default,,0,0,0,,{anim_tags}{trending_tag}{group_text}"
            dialogues.append(dialogue)
            print(f"[Subtitle] Word group {len(dialogues)}: {format_ass_time(adjusted_start)} -> {format_ass_time(adjusted_end)}: {group_text[:30]}...")
            
            i = group_end
        
        print(f"[Subtitle] Generated {len(dialogues)} subtitle groups from word timestamps")
    else:
        # 回退：使用平均分配时间的分句显示
        print("[Subtitle] No word timestamps, using sentence-based timing")
        
        # 🔧 关键修复: 去掉文案中的真实换行符（会破坏 ASS Dialogue 的单行格式）
        text = text.replace('\n', '').replace('\r', '').strip()
        sentences = split_sentences(text)
        print(f"[Subtitle] Split into {len(sentences)} segments: {sentences}")
        
        # 获取配音时长
        voice_duration = subtitle.get('voiceDuration', 0)
        if voice_duration > 0:
            total_duration = voice_duration + SYNC_BUFFER
        else:
            # 没有配音时长，按句子数量估算（每句约 2 秒）
            total_duration = len(sentences) * 2.0
        
        # 按字符数比例分配时间（TTS 匀速读，字数比例 ≈ 时间比例）
        # 注意: 去掉 \N 换行标记再计算字符数，\N 不占语音时间
        bs_n = chr(92) + 'N'
        total_chars = sum(len(s.replace(bs_n, '')) for s in sentences)
        if total_chars == 0:
            total_chars = len(sentences)  # fallback: 平均分配
        print(f"[Subtitle] Total duration: {total_duration:.1f}s, total chars: {total_chars}, sentences: {len(sentences)}")
        
        # 生成多个 Dialogue 事件
        dialogues = []
        cumulative_time = 0.0
        for i, sentence in enumerate(sentences):
            clean_len = len(sentence.replace(bs_n, ''))
            char_ratio = clean_len / total_chars if total_chars > 0 else 1.0 / len(sentences)
            seg_duration = total_duration * char_ratio
            start_time = VOICE_DELAY_SECONDS + cumulative_time
            end_time = start_time + seg_duration
            cumulative_time += seg_duration
            
            # 不再手动 \N 换行——WrapStyle:0 + margins 让 libass 自动换行
            # 手动 \N 与 libass 自动换行冲突会导致部分文本不显示
            wrapped_sentence = sentence
            # 🎬 动画标签注入（预览模式跳过，因为 time=0 时 fad 使字幕透明）
            animation = subtitle.get('animation', 'fade')  # 默认淡入淡出
            anim_tags = '' if is_preview else build_animation_tags(animation, is_trending=is_trending)
            
            # 霓虹双层渲染：生成两条 Dialogue（底层光晕 Layer 0 + 顶层清晰文字 Layer 1）
            if is_neon:
                blur_tag = '{' + chr(92) + 'blur2}'  # blur2: 与 overlay 一致，清晰光晕
                glow_dialogue = f"Dialogue: 0,{format_ass_time(start_time)},{format_ass_time(end_time)},GlowLayer,,0,0,0,,{blur_tag}{anim_tags}{wrapped_sentence}"
                dialogues.append(glow_dialogue)
            
            # 潮流: xbord/ybord 控制内边距, \3a/\4a 控制半透明度
            trending_tag = r'{\xbord8\ybord4\3a&HA0&\4a&HA0&}' if is_trending else ''  # A0=63% 透明（与 overlay 一致）
            
            # 霓虹时 Default 直接用 Layer 1
            default_layer = 1 if is_neon else 0
            dialogue = f"Dialogue: {default_layer},{format_ass_time(start_time)},{format_ass_time(end_time)},Default,,0,0,0,,{anim_tags}{trending_tag}{wrapped_sentence}"
            dialogues.append(dialogue)
            print(f"[Subtitle] Segment {i+1}: {format_ass_time(start_time)} -> {format_ass_time(end_time)}: [{sentence}]")
        
        # 🔧 调试: 保存 Dialogue 到文件
        debug_path = os.path.join(OUTPUT_DIR, 'debug_dialogues.txt')
        with open(debug_path, 'w', encoding='utf-8') as dbf:
            for d_line in dialogues:
                dbf.write(d_line + '\n')
        print(f"[Subtitle] Debug dialogues saved to {debug_path}")
    # === TextOverlay 支持 ===
    text_overlays = subtitle.get('textOverlays', [])
    duration_per_image = subtitle.get('durationPerImage', 2.0)
    transition_duration = 0.5  # 与 build_fade_slideshow_cmd 保持一致
    
    overlay_styles = []
    overlay_dialogues = []
    
    # ⭐ 新增：随机位置生成辅助函数
    def has_collision(rect, zones):
        """检查矩形是否与禁止区域重叠"""
        for zone in zones:
            if (rect['x'] < zone['x'] + zone['width'] and
                rect['x'] + rect['width'] > zone['x'] and
                rect['y'] < zone['y'] + zone['height'] and
                rect['y'] + rect['height'] > zone['y']):
                return True
        return False
    
    def estimate_box_height(text, box_width, font_size):
        """估算文本框高度（百分比）"""
        chars_per_line = max(1, int(box_width * 10.8 / max(font_size, 1)))
        lines = (len(text) + chars_per_line - 1) // chars_per_line
        line_height_percent = font_size / 19.2 * 1.5
        return min(lines * line_height_percent, 30)
    
    def generate_random_position(box_width, box_height, voice_subtitle_y, existing_rects, margin=10):
        """安全随机位置生成（带碰撞检测）"""
        # 参数边界验证
        box_width = max(5, min(90, box_width))
        box_height = max(3, min(50, box_height))
        
        forbidden_zones = [
            {'x': 0, 'y': voice_subtitle_y - 5, 'width': 100, 'height': 15}
        ] + existing_rects
        
        # 策略1: 随机尝试
        for _ in range(50):
            x = margin + random.random() * (100 - box_width - margin * 2)
            y_min = max(margin, 15)  # ⭐ 至少从 15% 开始，避开顶部 letterbox 白区
            y = y_min + random.random() * (100 - box_height - y_min - margin)
            rect = {'x': x, 'y': y, 'width': box_width, 'height': box_height}
            if not has_collision(rect, forbidden_zones):
                return round(x), round(y)
        
        # 策略2: 网格扫描
        for grid_y in range(int(margin), int(90 - box_height), 10):
            for grid_x in range(int(margin), int(90 - box_width), 10):
                rect = {'x': grid_x, 'y': grid_y, 'width': box_width, 'height': box_height}
                if not has_collision(rect, forbidden_zones):
                    return grid_x, grid_y
        
        # 兜底
        return int(margin), int(margin + 20)
    
    def generate_random_style():
        """随机样式生成（带对比度）"""
        styles = ['classic', 'trending', 'cinema', 'neon', 'minimal']
        colors = ['#FFD700', '#FFA500', '#FF69B4', '#00F2EA', '#4DA6FF', '#8B5CF6', '#FFFFFF', '#E0E0E0', '#FFFACD']
        
        color = random.choice(colors)
        light_colors = ['#FFD700', '#FFFFFF', '#E0E0E0', '#FFFACD', '#FF69B4']
        border = '#000000' if color in light_colors else '#FFFFFF'
        
        return {
            'style': random.choice(styles),
            'tone': random.choice(['warm', 'cool', 'neutral']),
            'color': color,
            'borderColor': border
        }
    
    # 已放置的 overlay 位置列表（用于碰撞检测）
    placed_rects = []
    voice_subtitle_y = subtitle.get('boxY', 75)  # 配音字幕Y位置
    
    if text_overlays and len(text_overlays) > 0:
        print(f"[Subtitle] Processing {len(text_overlays)} text overlays")
        
        for idx, overlay in enumerate(text_overlays):
            # 过滤空文本
            overlay_text = overlay.get('text', '').strip()
            if not overlay_text:
                continue
            
            # 获取 overlay 属性
            image_index = overlay.get('imageIndex', 0)
            o_style = overlay.get('style', 'classic')
            o_color = overlay.get('color', '#FFFFFF')
            o_font_size = overlay.get('fontSize', 14)
            o_box_x = overlay.get('boxX', 10)
            o_box_y = overlay.get('boxY', 20)
            o_box_width = overlay.get('boxWidth', 80)
            o_font_weight = overlay.get('fontWeight', '700')  # ⭐ 默认粗体
            o_border_width = overlay.get('borderWidth', 2)
            o_border_color = overlay.get('borderColor', '#000000')
            o_shadow = overlay.get('shadow', True)
            
            # ⭐ overlay 独立字体检测
            o_font_family_id = overlay.get('fontFamily', '')
            o_font_name = detect_available_font(o_font_family_id) if o_font_family_id else font_name
            print(f"[Subtitle] TextOverlay {idx}: Font: requested='{o_font_family_id}' -> detected='{o_font_name}'")
            
            # ⭐ 新增：处理 positionMode（随机位置）
            position_mode = overlay.get('positionMode', 'fixed')
            if position_mode == 'random':
                o_box_height = overlay.get('boxHeight') or estimate_box_height(overlay_text, o_box_width, o_font_size)
                new_x, new_y = generate_random_position(o_box_width, o_box_height, voice_subtitle_y, placed_rects)
                o_box_x = new_x
                o_box_y = new_y
                print(f"[Subtitle] TextOverlay {idx}: Random position -> ({o_box_x}, {o_box_y})")
            
            # ⭐ 新增：处理 styleMode（继承/随机样式）
            style_mode = overlay.get('styleMode', 'custom')
            if style_mode == 'random':
                random_style = generate_random_style()
                o_style = random_style['style']
                o_color = random_style['color']
                o_border_color = random_style['borderColor']
                print(f"[Subtitle] TextOverlay {idx}: Random style -> {o_style}, {o_color}")
            elif style_mode == 'inherit':
                o_style = subtitle.get('style', 'classic')
                # 不覆盖 o_color — 前端创建 overlay 时已将 subtitle.color 复制到 overlay.color
                # 用户后续更改 overlay 颜色后，overlay.color 会被更新为用户选择的颜色
                print(f"[Subtitle] TextOverlay {idx}: Inherit style -> {o_style}, color kept as {o_color}")
            
            # 更新 overlay 对象（用于后续日志和处理）
            overlay['boxX'] = o_box_x
            overlay['boxY'] = o_box_y
            
            # 记录已放置位置（用于下一个 overlay 的碰撞检测）
            o_box_height = overlay.get('boxHeight') or estimate_box_height(overlay_text, o_box_width, o_font_size)
            placed_rects.append({
                'x': o_box_x,
                'y': o_box_y,
                'width': o_box_width,
                'height': o_box_height
            })
            
            # 颜色转换
            o_primary_color = hex_to_ass_color(o_color)
            o_outline_color = hex_to_ass_color(o_border_color)
            
            # 字号缩放
            o_scaled_font_size = int(o_font_size * scale_factor)
            # 影视(cinema)样式细体补偿放大 15%
            if o_style == 'cinema':
                o_scaled_font_size = int(o_scaled_font_size * 1.15)
            o_actual_font_size = max(48, min(360, o_scaled_font_size))
            print(f"[Subtitle] TextOverlay {idx}: fontSize {o_font_size}px * {scale_factor:.2f} = {o_actual_font_size}px")
            
            # 粗体判断
            try:
                o_weight = int(o_font_weight) if o_font_weight else 400
            except (ValueError, TypeError):
                o_weight = 400
            o_bold = 1 if o_weight >= 500 else 0
            
            # ⭐ 根据 o_style 动态设置 ASS 参数（保留用户自定义值，preset 仅作默认回退）
            o_border_style = 1  # 默认普通描边
            o_ass_outline = o_outline_color
            o_back_color = "&H80000000"
            o_shadow_depth = 2 if o_shadow else 0
            o_spacing = 0
            o_is_neon = False
            
            # 保存用户原始配置（用于判断是否被 preset 覆盖）
            user_border_width = overlay.get('borderWidth')  # None = 用户未设置
            user_bold = o_bold  # 已从 fontWeight 计算
            user_shadow = overlay.get('shadow')  # None/True/False
            
            if o_style == 'classic':
                o_ass_outline = "&H00000000"
                # 📺 经典风格：与配音字幕一致的粗描边 + 深阴影（bord=4, shadow=3）
                o_border_width = max(user_border_width if user_border_width is not None else 4, 2)
                o_shadow_depth = 0 if user_shadow is False else 3
                o_back_color = "&H90000000"
                o_bold = 1  # ⭐ 强制粗体（和配音字幕一致）
            elif o_style == 'trending':
                o_border_style = 3  # 方框背景模式
                # 透明度由 Dialogue 行的 \3a/\4a 覆盖标签控制（比 Style 行 alpha 更可靠）
                o_ass_outline = "&H00000000"  # 纯黑色
                o_border_width = user_border_width if user_border_width is not None else 0
                o_shadow_depth = 0
                o_back_color = "&H00000000"  # 纯黑色
                o_bold = 1
            elif o_style == 'cinema':
                o_ass_outline = "&H00000000"
                o_border_width = user_border_width if user_border_width is not None else 1
                o_shadow_depth = 0 if user_shadow is False else 2
                o_back_color = "&H60000000"
                o_spacing = 4
            elif o_style == 'neon':
                o_is_neon = True
                o_tone = overlay.get('tone', 'cool')
                o_ass_outline = "&H00804000" if o_tone == 'cool' else "&H00000044" if o_tone == 'warm' else "&H00333333"
                o_border_width = user_border_width if user_border_width is not None else 2  # B方案：与 GlowLayer Outline=2 匹配
                o_shadow_depth = 0
                o_back_color = "&H00000000"
                o_bold = 1  # ⭐ 强制粗体
            elif o_style == 'minimal':
                o_ass_outline = "&H00000000"
                o_border_width = user_border_width if user_border_width is not None else 0
                o_shadow_depth = 0 if user_shadow is False else 1
                o_back_color = "&HC0000000"
            
            print(f"[Subtitle] TextOverlay {idx}: Style={o_style}, BorderStyle={o_border_style}, neon={o_is_neon}")
            
            # 边距计算 — margin 同时控制定位 + 换行宽度（不使用 \pos，避免覆盖换行）
            o_margin_l = int(video_width * o_box_x / 100)
            o_margin_r = int(video_width * (100 - o_box_x - o_box_width) / 100)
            o_margin_v = int(video_height * o_box_y / 100)  # 垂直定位由 margin 控制
            
            # Style 名称
            style_name_base = f"Overlay{idx}"
            
            # ⭐ Neon B方案：GlowLayer Outline=2（与 Default 匹配），光晕色跟随色调
            if o_is_neon:
                o_tone = overlay.get('tone', 'cool')
                neon_glow_color = "&H00EAF200" if o_tone == 'cool' else "&H00F65C8B" if o_tone == 'warm' else "&H00FFCC88"
                # Outline=2: 与 Default 一致，确保定位对齐
                glow_style_line = f"Style: {style_name_base}Glow,{o_font_name},{o_actual_font_size},{neon_glow_color},&H000000FF,{neon_glow_color},&H00000000,{o_bold},0,0,0,100,100,{o_spacing},0,1,2,0,8,{o_margin_l},{o_margin_r},{o_margin_v},0"
                overlay_styles.append(glow_style_line)
            
            # 创建 Style 行 - alignment=8 (顶部居中)，margin 控制定位和换行
            style_line = f"Style: {style_name_base},{o_font_name},{o_actual_font_size},{o_primary_color},&H000000FF,{o_ass_outline},{o_back_color},{o_bold},0,0,0,100,100,{o_spacing},0,{o_border_style},{o_border_width},{o_shadow_depth},8,{o_margin_l},{o_margin_r},{o_margin_v},0"
            overlay_styles.append(style_line)
            
            # 获取时间模式
            timing_mode = overlay.get('timingMode', 'image')
            
            if timing_mode == 'custom':
                # 自由模式：百分比 → 秒
                total_duration = subtitle.get('totalDuration', 10.0)
                start_percent = overlay.get('startPercent', 0)
                end_percent = overlay.get('endPercent', 100)
                start_time = total_duration * start_percent / 100
                end_time = total_duration * end_percent / 100
                print(f"[Subtitle] TextOverlay {idx} (custom): {start_percent}%-{end_percent}% of {total_duration:.1f}s = {start_time:.2f}s-{end_time:.2f}s")
            else:
                # 图片模式：基于 imageIndex
                image_index = overlay.get('imageIndex', 0)
                # 每张图片时间: imageIndex * durationPerImage -> (imageIndex + 1) * durationPerImage
                # 考虑转场：有转场时总时长 = n * duration - (n-1) * fade
                start_time = image_index * duration_per_image - image_index * transition_duration
                # ⭐ 结束时间提前 transition_duration，避免与下一张图的 overlay 时间重叠
                end_time = (image_index + 1) * duration_per_image - image_index * transition_duration - transition_duration
                print(f"[Subtitle] TextOverlay {idx} (image): imageIndex={image_index}, {format_ass_time(start_time)}->{format_ass_time(end_time)}")
            
            # 确保时间不为负，并添加 0.5s 延迟让文本不在第一帧就出现
            start_time = max(0, start_time) + 0.5
            
            # 🎬 动画标签（纯 transform，不依赖 \pos）
            overlay_animation = overlay.get('animation') or subtitle.get('animation', 'fade')
            overlay_anim_tags = build_animation_tags(overlay_animation, 0, 0, is_trending=(o_style == 'trending'))
            
            # 🔧 TextOverlay 文本换行(防止 neon 双层因 Outline 宽度不同导致错位)
            o_available_width = video_width - o_margin_l - o_margin_r
            # 语言感知：中文全角 0.78, 英文半角 0.50
            o_chinese_ratio = len(re.findall(r'[\u4e00-\u9fff]', overlay_text)) / max(len(overlay_text), 1)
            o_char_width_est = o_actual_font_size * (0.78 if o_chinese_ratio > 0.3 else 0.50)
            o_max_line_chars = max(6, int(o_available_width / o_char_width_est) - 1)
            raw_overlay_text = strip_emoji(overlay_text).replace('\n', '').replace('\r', '')
            o_chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', raw_overlay_text))
            if o_chinese_chars > len(raw_overlay_text) * 0.3 and len(raw_overlay_text) > o_max_line_chars:
                o_lines = []
                o_cur = ""
                for ch in raw_overlay_text:
                    o_cur += ch
                    if ch in '，,、；：' and len(o_cur) >= 4:
                        o_lines.append(o_cur)
                        o_cur = ""
                    elif len(o_cur) >= o_max_line_chars:
                        o_lines.append(o_cur)
                        o_cur = ""
                if o_cur:
                    if o_lines and len(o_cur) <= 3 and len(o_lines[-1]) + len(o_cur) <= o_max_line_chars:
                        o_lines[-1] += o_cur
                    else:
                        o_lines.append(o_cur)
                wrapped_overlay = (chr(92) + 'N').join(o_lines)
            else:
                wrapped_overlay = raw_overlay_text
            
            print(f"[Subtitle] TextOverlay {idx} neon={o_is_neon}: maxChars={o_max_line_chars}, text=[{wrapped_overlay}]")
            
            # Neon 크层渲染：底层光晕 Dialogue
            if o_is_neon:
                blur_tag = '{' + chr(92) + 'blur2}'  # overlay 用 blur2（文字较小，blur3 过于模糊）
                glow_dialogue = f"Dialogue: 0,{format_ass_time(start_time)},{format_ass_time(end_time)},{style_name_base}Glow,,0,0,0,,{blur_tag}{overlay_anim_tags}{wrapped_overlay}"
                overlay_dialogues.append(glow_dialogue)
            
            o_trending_tag = r'{\xbord8\ybord4\3a&HA0&\4a&HA0&}' if o_style == 'trending' else ''  # A0=63% 透明（比配音字幕 D0=82% 更不透明，overlay 需要更强底色）
            
            o_default_layer = 1 if o_is_neon else 0
            dialogue_line = f"Dialogue: {o_default_layer},{format_ass_time(start_time)},{format_ass_time(end_time)},{style_name_base},,0,0,0,,{overlay_anim_tags}{o_trending_tag}{wrapped_overlay}"
            overlay_dialogues.append(dialogue_line)
            
            print(f"[Subtitle] TextOverlay {idx}: {overlay_text[:30]}...")
    
    # 组合 Styles 和 Dialogues
    all_styles = [f"Style: Default,{font_name},{actual_font_size},{primary_color},&H000000FF,{outline_color},{back_color},{bold},0,0,0,100,100,{spacing},0,{border_style},{border_width},{shadow_depth},{alignment},{margin_l},{margin_r},{margin_v},0"]
    
    # 霓虹 B方案：GlowLayer Outline=2（与 Default 一致避免偏移），光晕色跟随色调
    if is_neon:
        tone = subtitle.get('tone', 'cool')
        neon_glow_color = "&H00EAF200" if tone == 'cool' else "&H00F65C8B" if tone == 'warm' else "&H00FFCC88"
        glow_style = f"Style: GlowLayer,{font_name},{actual_font_size},{neon_glow_color},&H000000FF,{neon_glow_color},&H00000000,{bold},0,0,0,100,100,{spacing},0,1,2,0,{alignment},{margin_l},{margin_r},{margin_v},0"
        all_styles.append(glow_style)
    
    all_styles.extend(overlay_styles)
    
    # 配音字幕使用更高 Layer（在 TextOverlay 上面）
    # 霓虹样式已经自行处理了 Layer 分配（GlowLayer=0, Default=1）
    all_dialogues = []
    for d in dialogues:
        if not is_preview:
            if is_neon:
                # 霓虹双层：GlowLayer 用 Layer 0，Default 用 Layer 1（已在生成时设置）
                # 提升两层以确保都在 TextOverlay 上面
                if d.startswith("Dialogue: 0,"):
                    d = "Dialogue: 1," + d[12:]  # GlowLayer: 0 -> 1
                elif d.startswith("Dialogue: 1,"):
                    d = "Dialogue: 2," + d[12:]  # Default: 1 -> 2
            else:
                # 非霓虹：统一提升到 Layer 1
                if d.startswith("Dialogue: 0,"):
                    d = "Dialogue: 1," + d[12:]
        all_dialogues.append(d)
    
    # TextOverlay 使用 Layer 0（在下面）
    all_dialogues.extend(overlay_dialogues)
    
    # ASS 文件内容 - 使用动态分辨率
    ass_content = f"""[Script Info]
Title: Slideshow Subtitle
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{chr(10).join(all_styles)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
{chr(10).join(all_dialogues)}
"""
    return ass_content


def strip_emoji(text: str) -> str:
    """
    移除 emoji 和其他可能导致字体渲染问题的特殊字符
    仅保留基本的 ASCII、中文、日文、韩文和常用标点符号
    """
    import re
    
    if not text:
        return text
    
    # 移除 emoji 和其他特殊 Unicode 字符
    # 保留: ASCII (0x20-0x7E), 中文 (0x4E00-0x9FFF), 日文平假名/片假名, 常用标点
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"  # emoticons
        "\U0001F300-\U0001F5FF"  # symbols & pictographs
        "\U0001F680-\U0001F6FF"  # transport & map symbols
        "\U0001F700-\U0001F77F"  # alchemical symbols
        "\U0001F780-\U0001F7FF"  # geometric shapes extended
        "\U0001F800-\U0001F8FF"  # supplemental arrows-c
        "\U0001F900-\U0001F9FF"  # supplemental symbols & pictographs
        "\U0001FA00-\U0001FA6F"  # chess symbols
        "\U0001FA70-\U0001FAFF"  # symbols & pictographs extended-a
        "\U00002702-\U000027B0"  # dingbats
        "\U0001F1E0-\U0001F1FF"  # flags (iOS)
        "]+",
        flags=re.UNICODE
    )
    
    cleaned = emoji_pattern.sub('', text)
    
    # 移除其他可能有问题的字符（如零宽字符）
    cleaned = re.sub(r'[\u200b-\u200f\u2060-\u206f\ufeff]', '', cleaned)
    
    # 清理多余空格
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    
    return cleaned


def wrap_text(text: str, font_size: int, video_width: int = 1080) -> str:
    """
    根据视频宽度和字体大小自动换行文本
    
    计算逻辑:
    - 视频宽度: 1080px (9:16) 或 1920px (16:9)
    - 预留边距: 左右各 4% = 8% (边距较小，更多文字空间)
    - 可用宽度: video_width * 0.92
    - 中文字符宽度 ≈ font_size
    - 每行最大字符数 ≈ (video_width * 0.92) / font_size
    """
    if not text:
        return text
    
    # 计算每行最大字符数 (留 8% 边距，左右各 4%)
    available_width = video_width * 0.92
    # 中文字符宽度约等于字体大小，英文约 0.6 倍
    # 这里按中文计算（保守估计）
    max_chars_per_line = int(available_width / font_size)
    
    # 如果文本本身就短，无需换行
    if len(text) <= max_chars_per_line:
        return text
    
    # 手动换行
    lines = []
    current_line = ""
    for char in text:
        current_line += char
        if len(current_line) >= max_chars_per_line:
            lines.append(current_line)
            current_line = ""
    if current_line:
        lines.append(current_line)
    
    # 用换行符连接 (FFmpeg drawtext 支持 \n)
    return '\n'.join(lines)


def build_subtitle_filter(subtitle: dict, duration: float, work_dir: str = None, aspect_ratio: str = '9:16') -> str:
    """
    构建字幕 drawtext 滤镜 - 增强版
    支持: 精确 Y 轴位置、自定义字体、描边、阴影、自动换行
    
    重要: 使用 textfile 参数处理中文字符，避免 Windows 命令行编码问题
    
    SubtitleConfig 结构:
    {
        text: string,
        position: number (0-100, 百分比),
        fontSize: number (24-72),
        fontColor: string (#FFFFFF),
        fontFamily: string (字体文件名),
        borderWidth: number (0-5),
        borderColor: string (#000000),
        shadow: boolean,
        voiceDuration: number (配音时长，可选)
    }
    """
    if not subtitle or not subtitle.get('text'):
        return None
    
    # 调试：打印收到的字幕配置
    print(f"[Subtitle] Received config: voiceDuration={subtitle.get('voiceDuration', 'NOT SET')}")
    print(f"[Subtitle] Style check: style='{subtitle.get('style', 'NOT SET')}', is_neon={subtitle.get('style') == 'neon'}")
    
    font_size = subtitle.get('fontSize', 36)
    # 颜色读取：优先 fontColor，回退到 color，最后默认白色
    font_color = subtitle.get('fontColor') or subtitle.get('color') or '#FFFFFF'
    
    # 调试：打印颜色信息
    print(f"[Subtitle] Color config: fontColor={subtitle.get('fontColor')}, color={subtitle.get('color')}, using={font_color}")
    
    # 1. 先过滤 emoji 和特殊字符
    raw_text = subtitle.get('text', '')
    clean_text = strip_emoji(raw_text)
    if clean_text != raw_text:
        print(f"[Subtitle] Stripped emojis: '{raw_text}' -> '{clean_text}'")
    
    # 2. 自动换行处理
    text = wrap_text(clean_text, font_size)
    
    # 将字幕写入 ASS 格式文件（FFmpeg 对 ASS 的 UTF-8 支持更好）
    ass_path = None
    
    if work_dir:
        try:
            ass_path = os.path.join(work_dir, "subtitle.ass")
            
            # 生成 ASS 字幕文件
            # ASS 格式对中文支持更好，且可以精确控制样式
            ar = subtitle.get('_aspect_ratio', aspect_ratio)
            ass_content = generate_ass_subtitle(text, font_size, font_color, subtitle, ar)
            
            with open(ass_path, 'w', encoding='utf-8') as f:
                f.write(ass_content)
            
            print(f"[Subtitle] ASS file created: {ass_path}")
            print(f"[Subtitle] Text content: {text}")
            print(f"[Subtitle] ASS preview (first 500 chars):")
            print(ass_content[:500])
            
            # === 关键修复：将字体文件复制到 work_dir ===
            # FFmpeg fontsdir 不递归搜索子目录，所以需要将字体文件复制到同一目录
            import shutil
            font_family_id = subtitle.get('fontFamily', '')
            font_paths = FONT_LOOKUP.get(font_family_id, [])
            fonts_copied = False
            for fp in font_paths:
                if os.path.exists(fp):
                    dest = os.path.join(work_dir, os.path.basename(fp))
                    if not os.path.exists(dest):
                        shutil.copy2(fp, dest)
                    print(f"[Subtitle] Font file copied to work_dir: {os.path.basename(fp)}")
                    fonts_copied = True
                    break
            
            if not fonts_copied:
                print(f"[Subtitle] WARNING: Font '{font_family_id}' not found, FFmpeg will use fallback")
            
            # ⭐ 复制 overlay 独立字体文件到 work_dir
            copied_font_ids = {font_family_id}  # 跟踪已复制的字体，避免重复
            for overlay_item in subtitle.get('textOverlays', []):
                o_fid = overlay_item.get('fontFamily', '')
                if o_fid and o_fid not in copied_font_ids:
                    copied_font_ids.add(o_fid)
                    for fp in FONT_LOOKUP.get(o_fid, []):
                        if os.path.exists(fp):
                            dest = os.path.join(work_dir, os.path.basename(fp))
                            if not os.path.exists(dest):
                                shutil.copy2(fp, dest)
                            print(f"[Subtitle] Overlay font copied: {o_fid} -> {os.path.basename(fp)}")
                            break
            
            # FFmpeg ass 滤镜需要正斜杠路径，冒号需要转义
            ass_escaped = ass_path.replace('\\', '/').replace(':', r'\:')
            
            # fontsdir 指向 work_dir（字体文件已复制到此处）
            fonts_dir = work_dir.replace('\\', '/').replace(':', r'\:')
            return f"ass='{ass_escaped}':fontsdir='{fonts_dir}'"
            
        except Exception as e:
            print(f"[Subtitle] ERROR creating ASS file: {e}")
            # 回退到 drawtext（可能乱码）
            escaped_text = text.replace("'", "\\'").replace(":", r"\:")
            text_param = f"text='{escaped_text}'"
    else:
        # 回退方案
        escaped_text = text.replace("'", "\\'").replace(":", r"\:")
        text_param = f"text='{escaped_text}'"
        print(f"[Subtitle] Using inline text (no work_dir): {text}")
    
    # Y 轴位置: 0-100 百分比 -> FFmpeg 表达式
    position = subtitle.get('position', 80)  # 默认 80% (底部)
    if isinstance(position, (int, float)):
        # 数字类型: 转为 FFmpeg 表达式
        y_expr = f'h*{position / 100}'
    else:
        # 兼容旧的字符串类型 ('top', 'center', 'bottom')
        if position == 'top':
            y_expr = 'h*0.08'
        elif position == 'center':
            y_expr = '(h-th)/2'
        else:  # bottom
            y_expr = 'h-th-h*0.08'
    
    # 字体文件路径 - 使用 PROJECT_DIR 确保路径正确
    # 优先使用支持中文的字体（如思源黑体、微软雅黑）
    font_family = subtitle.get('fontFamily', '')
    fontfile_param = ''
    
    # 查找字体文件路径
    font_paths = [
        # 用户指定的字体
        PROJECT_DIR / 'public' / 'fonts' / f'{font_family}.ttf',
        PROJECT_DIR / 'public' / 'fonts' / font_family / f'{font_family}.ttf',
        # 中文字体回退 - Noto Sans SC (思源黑体)
        PROJECT_DIR / 'public' / 'fonts' / 'NotoSansSC' / 'NotoSansSC-Regular.ttf',
        PROJECT_DIR / 'public' / 'fonts' / 'NotoSansSC-Regular.ttf',
        # Windows 系统中文字体
        Path('C:/Windows/Fonts/msyh.ttc'),  # 微软雅黑
        Path('C:/Windows/Fonts/simhei.ttf'),  # 黑体
        # 其他字体
        PROJECT_DIR / 'public' / 'fonts' / 'Cinzel' / 'Cinzel-VariableFont_wght.ttf',
        PROJECT_DIR / 'public' / 'fonts' / 'EB_Garamond' / 'EBGaramond-VariableFont_wght.ttf',
    ]
    
    fontfile = None
    for fp in font_paths:
        if fp.exists():
            # FFmpeg 需要正斜杠路径
            fontfile = str(fp).replace('\\', '/')
            print(f"Found font file: {fontfile}")
            break
    
    if fontfile:
        # FFmpeg drawtext fontfile 路径需要转义冒号
        fontfile_escaped = fontfile.replace(':', r'\:')
        fontfile_param = f":fontfile='{fontfile_escaped}'"
    else:
        print(f"Warning: No suitable font found, using system default")
    
    # 描边参数
    border_width = subtitle.get('borderWidth', 0)
    border_color = subtitle.get('borderColor', 'black')
    border_param = f':borderw={border_width}:bordercolor={border_color}' if border_width > 0 else ''
    
    # 阴影参数 (仅当 shadow=True 时添加)
    has_shadow = subtitle.get('shadow', False)
    shadow_param = ':shadowcolor=black@0.5:shadowx=2:shadowy=2' if has_shadow else ''
    
    # 构建完整 drawtext 滤镜
    return f"drawtext={text_param}:fontsize={font_size}:fontcolor={font_color}:x=(w-tw)/2:y={y_expr}{fontfile_param}{border_param}{shadow_param}"


def build_simple_slideshow_cmd(images: list, output: str, duration: float, music: str = None, subtitle: dict = None, work_dir: str = None):
    """构建简单轮播命令(无转场)"""
    # 如果没有 work_dir，从图片路径派生
    if not work_dir:
        work_dir = os.path.dirname(images[0])
    
    # 创建图片列表文件
    list_file = os.path.join(work_dir, "images.txt")
    with open(list_file, 'w') as f:
        for img in images:
            f.write(f"file '{img}'\n")
            f.write(f"duration {duration}\n")
        # 最后一张需要再写一次(FFmpeg 要求)
        f.write(f"file '{images[-1]}'\n")
    
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", list_file,
    ]
    
    if music:
        cmd.extend(["-i", music, "-shortest"])
    
    # 构建视频滤镜
    vf_parts = ["fps=30"]
    sub_filter = build_subtitle_filter(subtitle, duration, work_dir)
    if sub_filter:
        vf_parts.append(sub_filter)
    
    cmd.extend([
        "-vf", ",".join(vf_parts),
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
    ])
    
    if music:
        cmd.extend(["-c:a", "aac", "-b:a", "128k"])
    else:
        cmd.extend(["-an"])
    
    cmd.append(output)
    return cmd


def build_fade_slideshow_cmd(images: list, output: str, duration: float, music: str = None, subtitle: dict = None, transition: str = "fade", work_dir: str = None):
    """构建转场轮播命令 - 支持多种转场效果"""
    # 如果没有 work_dir，从图片路径派生
    if not work_dir:
        work_dir = os.path.dirname(images[0])
    
    fade_duration = 0.5  # 转场时长
    
    # 输入文件
    inputs = []
    for img in images:
        inputs.extend(["-loop", "1", "-t", str(duration), "-i", img])
    
    # 构建 filter_complex
    n = len(images)
    filters = []
    
    # 设置帧率
    for i in range(n):
        filters.append(f"[{i}:v]fps=30,format=yuv420p[v{i}]")
    
    # 添加淡入淡出
    if n == 1:
        # 单图片时先添加淡入淡出，然后添加字幕
        base_filter = f"[v0]fade=t=in:st=0:d={fade_duration},fade=t=out:st={duration-fade_duration}:d={fade_duration}"
        
        # 添加字幕滤镜
        try:
            sub_filter = build_subtitle_filter(subtitle, duration, work_dir)
            if sub_filter:
                single_filter = f"{base_filter}[pre_sub];[pre_sub]{sub_filter}[outv]"
            else:
                single_filter = f"{base_filter}[outv]"
        except Exception as e:
            import traceback
            print(f"[Subtitle] ERROR in build_subtitle_filter (n=1): {e}")
            traceback.print_exc()
            single_filter = f"{base_filter}[outv]"
        
        # ⭐ 关键修复：将 fps/format 预处理（定义 [v0] 标签）合并到 filter_str 中
        filter_str = ";".join(filters) + ";" + single_filter
    else:
        # 使用 xfade 连接 - 支持多种转场效果
        # 可用效果: fade, wipeleft, wiperight, wipeup, wipedown, slideleft, slideright, 
        #          slideup, slidedown, circlecrop, rectcrop, distance, fadeblack, fadewhite,
        #          radial, smoothleft, smoothright, smoothup, smoothdown, circleopen, 
        #          circleclose, vertopen, vertclose, horzopen, horzclose, dissolve, pixelize
        transition_effect = "fade" if transition == "fade" else transition
        prev = "v0"
        for i in range(1, n):
            offset = i * duration - fade_duration * i
            out_label = f"xf{i}" if i < n-1 else "outv_pre"
            filters.append(f"[{prev}][v{i}]xfade=transition={transition_effect}:duration={fade_duration}:offset={offset}[{out_label}]")
            prev = out_label
        
        # 添加字幕滤镜
        try:
            sub_filter = build_subtitle_filter(subtitle, duration * n, work_dir)
            if sub_filter:
                filters.append(f"[outv_pre]{sub_filter}[outv]")
            else:
                # 没有字幕时直接改名
                filters[-1] = filters[-1].replace("[outv_pre]", "[outv]")
        except Exception as e:
            import traceback
            print(f"[Subtitle] ERROR in build_subtitle_filter: {e}")
            traceback.print_exc()
            # 发生错误时跳过字幕，继续生成视频
            filters[-1] = filters[-1].replace("[outv_pre]", "[outv]")
        
        filter_str = ";".join(filters)
    
    # 构建命令 - 音乐输入需要在 filter_complex 之前
    if music:
        inputs.extend(["-i", music])
    
    cmd = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", filter_str,
        "-map", "[outv]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        # 使用完整颜色范围 (pc = 0-255) 而不是限制范围 (tv = 16-235)
        # 这确保字幕颜色与预览区一致
        "-color_range", "pc",
        "-colorspace", "bt709",
        "-color_primaries", "bt709",
        "-color_trc", "bt709",
    ]
    
    if music:
        cmd.extend(["-map", f"{n}:a", "-c:a", "aac", "-b:a", "128k", "-shortest"])
    else:
        cmd.extend(["-an"])
    
    cmd.append(output)
    return cmd


def generate_preview_frame(image_path: str, subtitle: dict, output_path: str, aspect_ratio: str = '9:16') -> bool:
    """
    生成单帧字幕预览图 — 用 FFmpeg 渲染，确保与最终视频像素级一致
    
    Args:
        image_path: 输入图片路径
        subtitle: 字幕配置 dict
        output_path: 输出预览图路径 (.jpg)
        aspect_ratio: 宽高比 '9:16' 或 '16:9'
    Returns:
        True if success
    """
    import shutil
    
    if not os.path.exists(image_path):
        print(f"[Preview] Image not found: {image_path}")
        return False
    
    # 目标分辨率
    if aspect_ratio == '16:9':
        w, h = 1920, 1080
    else:
        w, h = 1080, 1920
    
    work_dir = tempfile.mkdtemp(prefix="preview_")
    
    try:
        # 准备字幕文本 — 根据字体语言自适应默认文本
        en_fonts = ['Montserrat', 'BebasNeue', 'Pacifico', 'Cinzel', 'EBGaramond']
        font_family = subtitle.get('fontFamily', '')
        default_text = 'Subtitle Preview' if font_family in en_fonts else '配音文本效果'
        preview_text = subtitle.get('text', '') or default_text
        
        # 构建一个静态字幕（显示 0~10s，覆盖整个预览帧）
        preview_subtitle = {
            **subtitle,
            'text': preview_text,
            'voiceDuration': 10,  # 10 秒确保字幕可见
            'wordTimestamps': [],
            '_preview_mode': True,  # 跳过 VOICE_DELAY
        }
        
        font_size = preview_subtitle.get('fontSize', 36)
        font_color = preview_subtitle.get('fontColor') or preview_subtitle.get('color') or '#FFFFFF'
        
        # 生成 ASS
        ass_content = generate_ass_subtitle(
            text=preview_text,
            font_size=font_size,
            font_color=font_color,
            subtitle=preview_subtitle,
            aspect_ratio=aspect_ratio,
        )
        
        # 写入 ASS 文件
        ass_path = os.path.join(work_dir, "preview.ass")
        with open(ass_path, 'w', encoding='utf-8') as f:
            f.write(ass_content)
        
        # 复制字体文件到 work_dir
        font_family_id = subtitle.get('fontFamily', '')
        font_paths = FONT_LOOKUP.get(font_family_id, [])
        for fp in font_paths:
            if os.path.exists(fp):
                dest = os.path.join(work_dir, os.path.basename(fp))
                if not os.path.exists(dest):
                    shutil.copy2(fp, dest)
                print(f"[Preview] Font copied: {os.path.basename(fp)}")
                break
        
        # FFmpeg: 缩放图片 + 叠加字幕 → 输出单帧
        ass_escaped = ass_path.replace('\\', '/').replace(':', r'\:')
        fonts_dir = work_dir.replace('\\', '/').replace(':', r'\:')
        
        vf = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black,ass='{ass_escaped}':fontsdir='{fonts_dir}'"
        
        cmd = [
            "ffmpeg", "-y",
            "-i", image_path,
            "-vf", vf,
            "-vframes", "1",
            "-q:v", "2",
            # 颜色空间保持一致
            "-color_range", "pc",
            "-colorspace", "bt709",
            "-color_primaries", "bt709",
            "-color_trc", "bt709",
            output_path,
        ]
        
        print(f"[Preview] Running: {' '.join(cmd[:6])}...")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        
        if result.returncode != 0:
            print(f"[Preview] FFmpeg error: {result.stderr[-500:]}")
            return False
        
        print(f"[Preview] Generated: {output_path} ({os.path.getsize(output_path)} bytes)")
        return True
        
    except Exception as e:
        print(f"[Preview] Error: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description="Generate slideshow video from images")
    parser.add_argument("--mode", type=str, default="slideshow", choices=["slideshow", "preview"],
                        help="Mode: 'slideshow' for video, 'preview' for single frame subtitle preview")
    parser.add_argument("--images", type=str, required=True, help="JSON array of image paths")
    parser.add_argument("--output", type=str, required=True, help="Output video/image path")
    parser.add_argument("--aspect", type=str, default="9:16", choices=["9:16", "16:9"])
    parser.add_argument("--duration", type=float, default=2.0, help="Duration per image (seconds)")
    # 支持所有 xfade 转场效果
    parser.add_argument("--transition", type=str, default="fade", 
        choices=["none", "fade", "wipeleft", "wiperight", "wipeup", "wipedown", 
                 "slideleft", "slideright", "slideup", "slidedown", 
                 "circleopen", "circleclose", "dissolve", "pixelize",
                 "radial", "smoothleft", "smoothright", "fadeblack", "fadewhite"])
    parser.add_argument("--music", type=str, default=None, help="Background music path")
    parser.add_argument("--subtitle", type=str, default=None, help="Subtitle JSON: {text, position, fontSize, fontColor}")
    
    args = parser.parse_args()
    
    ensure_dirs()
    
    images = json.loads(args.images)
    subtitle = json.loads(args.subtitle) if args.subtitle else None
    
    if args.mode == "preview":
        # 预览模式：生成单帧带字幕的预览图
        if not images:
            print("[Preview] No images provided")
            sys.exit(1)
        if not subtitle:
            print("[Preview] No subtitle config provided")
            sys.exit(1)
        success = generate_preview_frame(
            image_path=images[0],
            subtitle=subtitle,
            output_path=args.output,
            aspect_ratio=args.aspect,
        )
        sys.exit(0 if success else 1)
    else:
        # 默认：生成轮播视频
        success = generate_slideshow(
            images=images,
            output_path=args.output,
            aspect_ratio=args.aspect,
            duration_per_image=args.duration,
            transition=args.transition,
            music_path=args.music,
            subtitle=subtitle,
        )
        sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

