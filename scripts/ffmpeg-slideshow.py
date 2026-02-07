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


def generate_ass_subtitle(text: str, font_size: int, font_color: str, subtitle: dict) -> str:
    """
    生成 ASS 格式字幕文件内容 - 支持分句显示
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
    
    # 检查是否是霓虹风格 - 需要特殊发光效果
    style_name = subtitle.get('style', 'classic')
    is_neon = style_name == 'neon'
    
    # 读取前端的字重设置 (fontWeight 可能是 '400', '600', '700' 等字符串)
    font_weight_str = subtitle.get('fontWeight', '400')
    try:
        font_weight = int(font_weight_str) if font_weight_str else 400
    except (ValueError, TypeError):
        font_weight = 400
    
    # 字重 >= 500 视为粗体 (CSS 的 font-weight: 500+ 为 medium 及以上)
    is_bold = font_weight >= 500 or is_neon  # 霓虹风格也强制粗体
    bold = 1 if is_bold else 0
    
    print(f"[Subtitle] Style: {style_name}, fontWeight: {font_weight_str} -> bold={bold}")
    
    if is_neon:
        # 霓虹风格: 描边和阴影都使用主色，模拟发光效果
        outline_color = primary_color  # 描边用主色
        border_width = 5  # 加粗描边模拟发光
        shadow_depth = 4  # 加深阴影
        # 阴影颜色也用主色（半透明）
        back_color = hex_to_ass_color(font_color).replace('&H00', '&H60')  # 40% 透明
        print(f"[Subtitle] Neon style: outline={outline_color}, shadow={back_color}")
    else:
        # 其他风格: 使用用户设置的描边颜色
        border_color = subtitle.get('borderColor', '#000000')
        outline_color = hex_to_ass_color(border_color)
        border_width = subtitle.get('borderWidth', 2)
        shadow_depth = 2 if subtitle.get('shadow', False) else 0
        back_color = "&H80000000"  # 默认黑色半透明阴影
    
    # 方框定位参数 (新版)
    box_x = subtitle.get('boxX', 10)  # 左边距百分比
    box_y = subtitle.get('boxY', 70)  # 上边距百分比
    box_width = subtitle.get('boxWidth', 80)  # 宽度百分比
    
    # 兼容旧版 position 参数
    position = subtitle.get('position', box_y)
    
    # 计算 ASS 边距 (基于 1080x1920 分辨率)
    video_width = 1080
    video_height = 1920
    margin_l = int(video_width * box_x / 100)
    margin_r = int(video_width * (100 - box_x - box_width) / 100)
    margin_v = int(video_height * (100 - position) / 100)
    
    # 字号缩放: 预览区字号 -> 实际视频字号
    # 预览区高度约 520px，视频高度 1920px
    # 用户看到的字号是相对于预览区的，需要放大到视频尺寸
    # 缩放因子 = 视频高度 / 预览区高度 ≈ 1920 / 520 ≈ 3.7
    PREVIEW_HEIGHT = 520  # 前端预览区的近似高度
    scale_factor = video_height / PREVIEW_HEIGHT  # ≈ 3.69
    
    # 计算实际视频字号: 用户设置的预览字号 * 缩放因子
    scaled_font_size = int(font_size * scale_factor)
    # 限制范围: 最小 48px (视频上可读)，最大 360px (不超出画面)
    actual_font_size = max(48, min(360, scaled_font_size))
    
    print(f"[Subtitle] Font scaling: preview {font_size}px * {scale_factor:.2f} = video {actual_font_size}px")
    
    alignment = 2  # 底部居中
    
    # 配音延迟 - 与 TypeScript 中的 VOICE_DELAY_MS 保持一致
    VOICE_DELAY_SECONDS = 1.0
    SYNC_BUFFER = 0.5
    
    # 格式化 ASS 时间 (H:MM:SS.CC)
    def format_ass_time(seconds: float) -> str:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = seconds % 60
        return f"{hours}:{minutes:02d}:{secs:05.2f}"
    
    # 拆分句子的函数
    def split_sentences(text: str) -> list:
        """
        将文案按句子拆分
        支持中英文标点：。！？.!? 以及逗号作为次要分隔符
        对于长句子，按单词边界拆分（不截断单词）
        """
        # 先按主要句子结束符拆分
        sentences = re.split(r'(?<=[。！？.!?])\s*', text)
        
        # 过滤空句子
        sentences = [s.strip() for s in sentences if s.strip()]
        
        # 如果只有一个长句子，尝试按逗号拆分
        if len(sentences) == 1 and len(sentences[0]) > 40:
            sub_sentences = re.split(r'(?<=[，,、;；])\s*', sentences[0])
            sub_sentences = [s.strip() for s in sub_sentences if s.strip()]
            if len(sub_sentences) > 1:
                sentences = sub_sentences
        
        # 对超长句子进行智能拆分（按单词边界）
        result = []
        max_chars = 35  # 每段最多显示的字符数
        
        for sentence in sentences:
            if len(sentence) <= max_chars:
                result.append(sentence)
                continue
            
            # 检测是否主要是中文（中文可以按字符分割）
            chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', sentence))
            is_chinese = chinese_chars > len(sentence) * 0.3
            
            if is_chinese:
                # 中文：按字符分割，但尽量在标点处断开
                current = ""
                for char in sentence:
                    current += char
                    if len(current) >= max_chars or char in '，。！？、；：':
                        if current.strip():
                            result.append(current.strip())
                        current = ""
                if current.strip():
                    result.append(current.strip())
            else:
                # 英文：按单词边界分割
                words = sentence.split()
                current_line = ""
                for word in words:
                    test_line = current_line + (" " if current_line else "") + word
                    if len(test_line) <= max_chars:
                        current_line = test_line
                    else:
                        if current_line:
                            result.append(current_line)
                        current_line = word
                if current_line:
                    result.append(current_line)
        
        return result if result else [text]
    
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
            
            # 拼接这组词的文本
            group_text = ' '.join([w['word'] for w in group])
            
            # 对文本进行自动换行处理
            if len(group_text) > 20:
                mid = len(group_text) // 2
                # 在空格处换行
                break_pos = mid
                for j in range(mid - 3, min(mid + 5, len(group_text))):
                    if j >= 0 and group_text[j] == ' ':
                        break_pos = j
                        break
                group_text = group_text[:break_pos] + '\\N' + group_text[break_pos+1:]
            
            # 添加延迟
            adjusted_start = VOICE_DELAY_SECONDS + group_start
            adjusted_end = VOICE_DELAY_SECONDS + group_end_time
            
            dialogue = f"Dialogue: 0,{format_ass_time(adjusted_start)},{format_ass_time(adjusted_end)},Default,,0,0,0,,{group_text}"
            dialogues.append(dialogue)
            print(f"[Subtitle] Word group {len(dialogues)}: {format_ass_time(adjusted_start)} -> {format_ass_time(adjusted_end)}: {group_text[:30]}...")
            
            i = group_end
        
        print(f"[Subtitle] Generated {len(dialogues)} subtitle groups from word timestamps")
    else:
        # 回退：使用平均分配时间的分句显示
        print("[Subtitle] No word timestamps, using sentence-based timing")
        
        # 拆分句子
        sentences = split_sentences(text)
        print(f"[Subtitle] Split into {len(sentences)} segments: {sentences}")
        
        # 获取配音时长
        voice_duration = subtitle.get('voiceDuration', 0)
        if voice_duration > 0:
            total_duration = voice_duration + SYNC_BUFFER
        else:
            # 没有配音时长，按句子数量估算（每句约 2 秒）
            total_duration = len(sentences) * 2.0
        
        # 计算每句的显示时长
        duration_per_sentence = total_duration / len(sentences)
        print(f"[Subtitle] Total duration: {total_duration:.1f}s, per sentence: {duration_per_sentence:.1f}s")
        
        # 生成多个 Dialogue 事件
        dialogues = []
        for i, sentence in enumerate(sentences):
            start_time = VOICE_DELAY_SECONDS + i * duration_per_sentence
            end_time = VOICE_DELAY_SECONDS + (i + 1) * duration_per_sentence
            
            # 对文本进行自动换行处理（如果单句仍然太长）
            wrapped_sentence = sentence
            if len(sentence) > 15:
                # 在中间位置插入换行符
                mid = len(sentence) // 2
                # 尝试找到一个好的换行位置（空格或标点附近）
                break_pos = mid
                for j in range(mid, min(mid + 5, len(sentence))):
                    if sentence[j] in ' ，,、':
                        break_pos = j + 1
                        break
                wrapped_sentence = sentence[:break_pos] + '\\N' + sentence[break_pos:]
            
            dialogue = f"Dialogue: 0,{format_ass_time(start_time)},{format_ass_time(end_time)},Default,,0,0,0,,{wrapped_sentence}"
            dialogues.append(dialogue)
            print(f"[Subtitle] Segment {i+1}: {format_ass_time(start_time)} -> {format_ass_time(end_time)}: {sentence[:30]}...")
    
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
            y = margin + random.random() * (100 - box_height - margin * 2)
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
            o_font_weight = overlay.get('fontWeight', '400')
            o_border_width = overlay.get('borderWidth', 2)
            o_border_color = overlay.get('borderColor', '#000000')
            o_shadow = overlay.get('shadow', True)
            
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
                o_color = subtitle.get('color', '#FFFFFF')
                # tone 用于 UI 但不直接影响渲染
                print(f"[Subtitle] TextOverlay {idx}: Inherit style -> {o_style}, {o_color}")
            
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
            o_actual_font_size = max(48, min(360, o_scaled_font_size))
            
            # 粗体判断
            try:
                o_weight = int(o_font_weight) if o_font_weight else 400
            except (ValueError, TypeError):
                o_weight = 400
            o_bold = 1 if o_weight >= 500 or o_style == 'neon' else 0
            
            # 阴影深度
            o_shadow_depth = 2 if o_shadow else 0
            
            # 边距计算 - 使用 \pos() 精确定位，margin 仅用于宽度限制
            o_margin_l = int(video_width * o_box_x / 100)
            o_margin_r = int(video_width * (100 - o_box_x - o_box_width) / 100)
            o_margin_v = 0  # 不使用 margin_v，改用 \pos() 精确定位
            
            # 计算 \pos() 坐标 (文本中心点)
            # pos_x: box 水平中心 = boxX + boxWidth/2
            # pos_y: box 顶部 = boxY (alignment=2 会让文本底部对齐此点，所以需要调整)
            o_pos_x = int(video_width * (o_box_x + o_box_width / 2) / 100)
            o_pos_y = int(video_height * o_box_y / 100)
            
            # Style 名称
            style_name = f"Overlay{idx}"
            
            # 创建 Style 行 - 使用 alignment=8 (顶部居中) 以便 \pos 指定顶部位置
            style_line = f"Style: {style_name},Microsoft YaHei,{o_actual_font_size},{o_primary_color},&H000000FF,{o_outline_color},&H80000000,{o_bold},0,0,0,100,100,0,0,1,{o_border_width},{o_shadow_depth},8,{o_margin_l},{o_margin_r},{o_margin_v},0"
            overlay_styles.append(style_line)
            
            # 保存坐标供 Dialogue 使用
            overlay['_pos_x'] = o_pos_x
            overlay['_pos_y'] = o_pos_y
            
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
                end_time = (image_index + 1) * duration_per_image - image_index * transition_duration
                print(f"[Subtitle] TextOverlay {idx} (image): imageIndex={image_index}, {format_ass_time(start_time)}->{format_ass_time(end_time)}")
            
            # 确保时间不为负
            start_time = max(0, start_time)
            
            # 获取 \pos() 坐标
            o_pos_x = overlay.get('_pos_x', 540)  # 默认中心
            o_pos_y = overlay.get('_pos_y', 200)
            
            # 创建 Dialogue 行（Layer 0，在配音字幕下方）
            # 使用 \pos(x,y) 精确定位覆盖 Style 的 margin 设置
            dialogue_line = f"Dialogue: 0,{format_ass_time(start_time)},{format_ass_time(end_time)},{style_name},,0,0,0,,{{\\pos({o_pos_x},{o_pos_y})}}{strip_emoji(overlay_text)}"
            overlay_dialogues.append(dialogue_line)
            
            print(f"[Subtitle] TextOverlay {idx}: {overlay_text[:30]}...")
    
    # 组合 Styles 和 Dialogues
    all_styles = [f"Style: Default,Microsoft YaHei,{actual_font_size},{primary_color},&H000000FF,{outline_color},{back_color},{bold},0,0,0,100,100,0,0,1,{border_width},{shadow_depth},{alignment},{margin_l},{margin_r},{margin_v},0"]
    all_styles.extend(overlay_styles)
    
    # 配音字幕使用 Layer 1（在上面）
    all_dialogues = []
    for d in dialogues:
        # 将 "Dialogue: 0," 替换为 "Dialogue: 1," 以确保在 TextOverlay 上面
        if d.startswith("Dialogue: 0,"):
            d = "Dialogue: 1," + d[12:]
        all_dialogues.append(d)
    
    # TextOverlay 使用 Layer 0（在下面）
    all_dialogues.extend(overlay_dialogues)
    
    # ASS 文件内容
    ass_content = f"""[Script Info]
Title: Slideshow Subtitle
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
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


def build_subtitle_filter(subtitle: dict, duration: float, work_dir: str = None) -> str:
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
            ass_content = generate_ass_subtitle(text, font_size, font_color, subtitle)
            
            with open(ass_path, 'w', encoding='utf-8') as f:
                f.write(ass_content)
            
            print(f"[Subtitle] ASS file created: {ass_path}")
            print(f"[Subtitle] Text content: {text}")
            
            # FFmpeg ass 滤镜需要正斜杠路径，冒号需要转义
            ass_escaped = ass_path.replace('\\', '/').replace(':', r'\:')
            
            # 使用 fontsdir 指定 Windows 字体目录，确保中文字体可用
            # force_style 强制使用 Microsoft YaHei 字体
            fonts_dir = "C:/Windows/Fonts".replace(':', r'\:')
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
                filter_str = f"{base_filter}[pre_sub];[pre_sub]{sub_filter}[outv]"
            else:
                filter_str = f"{base_filter}[outv]"
        except Exception as e:
            import traceback
            print(f"[Subtitle] ERROR in build_subtitle_filter (n=1): {e}")
            traceback.print_exc()
            filter_str = f"{base_filter}[outv]"
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


def main():
    parser = argparse.ArgumentParser(description="Generate slideshow video from images")
    parser.add_argument("--images", type=str, required=True, help="JSON array of image paths")
    parser.add_argument("--output", type=str, required=True, help="Output video path")
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
