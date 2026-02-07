#!/usr/bin/env python3
"""测试粉色字幕"""
import sys
import os
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent
SCRIPT_DIR = Path(__file__).parent

images = [
    str(PROJECT_DIR / "public" / "images" / "landing" / "avatar-1.png"),
    str(PROJECT_DIR / "public" / "images" / "landing" / "avatar-2.png"),
]

output_path = str(PROJECT_DIR / ".temp" / "slideshow" / "output" / "color_test_pink.mp4")

# 使用粉色 #EC4899
subtitle = {
    "text": "Pink Color Test - #EC4899",
    "fontSize": 18,  # 预览区 18px
    "fontColor": "#EC4899",  # 粉色
    "color": "#EC4899",  # 也设置 color 字段
    "position": 70,
    "borderWidth": 2,
    "borderColor": "#000000",
    "shadow": True,
    "boxX": 10,
    "boxY": 70,
    "boxWidth": 80,
    "style": "trending",
    "tone": "warm"
}

import importlib.util
spec = importlib.util.spec_from_file_location("slideshow", SCRIPT_DIR / "ffmpeg-slideshow.py")
slideshow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(slideshow)

print("=== 粉色字幕测试 ===")
print(f"字幕颜色: {subtitle['fontColor']}")
print()

os.makedirs(os.path.dirname(output_path), exist_ok=True)

result = slideshow.generate_slideshow(
    images=images,
    output_path=output_path,
    aspect_ratio="9:16",
    duration_per_image=2,
    transition="fade",
    subtitle=subtitle
)

if result:
    print()
    print("=== 测试成功 ===")
    print(f"视频: {output_path}")
else:
    print("=== 测试失败 ===")
