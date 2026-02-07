#!/usr/bin/env python3
"""
测试字幕字号缩放
"""
import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(__file__))

from pathlib import Path

# 导入 ffmpeg-slideshow 模块中的函数
PROJECT_DIR = Path(__file__).parent.parent
SCRIPT_DIR = Path(__file__).parent

# 测试参数
images = [
    str(PROJECT_DIR / "public" / "images" / "landing" / "avatar-1.png"),
    str(PROJECT_DIR / "public" / "images" / "landing" / "avatar-2.png"),
]

output_path = str(PROJECT_DIR / ".temp" / "slideshow" / "output" / "font_test_14px.mp4")

subtitle = {
    "text": "Test Subtitle Size - 14px Preview",
    "fontSize": 14,  # 预览区 14px, 预期视频 ~51px
    "fontColor": "#FFFFFF",
    "position": 70,
    "borderWidth": 2,
    "borderColor": "#000000",
    "shadow": True,
    "boxX": 10,
    "boxY": 70,
    "boxWidth": 80,
    "style": "classic",
    "tone": "neutral"
}

# 直接调用函数
import importlib.util
spec = importlib.util.spec_from_file_location("slideshow", SCRIPT_DIR / "ffmpeg-slideshow.py")
slideshow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(slideshow)

print("=== 测试开始 ===")
print(f"图片: {images}")
print(f"输出: {output_path}")
print(f"字幕字号: 预览 {subtitle['fontSize']}px")
print()

# 确保目录存在
os.makedirs(os.path.dirname(output_path), exist_ok=True)

# 生成视频
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
    print(f"视频已生成: {output_path}")
    print("请用视频播放器检查字幕大小")
else:
    print()
    print("=== 测试失败 ===")
