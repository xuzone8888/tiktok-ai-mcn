#!/usr/bin/env python3
"""测试霓虹粉色字幕"""
import sys
import os
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent
SCRIPT_DIR = Path(__file__).parent

images = [
    str(PROJECT_DIR / "public" / "images" / "landing" / "avatar-1.png"),
    str(PROJECT_DIR / "public" / "images" / "landing" / "avatar-2.png"),
]

output_path = str(PROJECT_DIR / ".temp" / "slideshow" / "output" / "neon_pink_test.mp4")

# 使用霓虹风格 + 粉色
subtitle = {
    "text": "Neon Pink Glow Test",
    "fontSize": 18,
    "fontColor": "#EC4899",
    "color": "#EC4899",
    "position": 70,
    "borderWidth": 0,  # 霓虹风格会覆盖这个
    "borderColor": "transparent",
    "shadow": True,
    "boxX": 10,
    "boxY": 70,
    "boxWidth": 80,
    "style": "neon",  # 关键: 霓虹风格
    "tone": "warm"
}

import importlib.util
spec = importlib.util.spec_from_file_location("slideshow", SCRIPT_DIR / "ffmpeg-slideshow.py")
slideshow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(slideshow)

print("=== 霓虹粉色发光测试 ===")
print(f"风格: {subtitle['style']}")
print(f"颜色: {subtitle['fontColor']}")
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
