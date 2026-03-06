"""
验证 B 方案霓虹效果 — 3 种色调各生成一张预览
同时验证 GlowLayer 和 Default 的 Outline=2 定位是否一致
"""
import subprocess, os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUTPUT_DIR = os.path.join(BASE, '.temp', 'neon_test')
FONTS_DIR = os.path.join(BASE, 'public', 'fonts', 'ZCOOLKuaiLe')
os.makedirs(OUTPUT_DIR, exist_ok=True)

FONT_NAME = "ZCOOL KuaiLe"
TEXT = "森林里的简单快乐"
FS = 38
W, H = 540, 960
ML, MR, MV = 60, 60, 200
bs = chr(92)

# B方案参数（与代码中完全一致）
TONES = {
    "cool": {
        "label": "B_cool 冷调",
        "glow_color": "&H00EAF200",      # 青色光晕
        "outline_color": "&H00804000",    # 深青描边
    },
    "warm": {
        "label": "B_warm 暖调",
        "glow_color": "&H00F65C8B",      # 紫粉光晕
        "outline_color": "&H00000044",    # 深红描边
    },
    "neutral": {
        "label": "B_neutral 中性",
        "glow_color": "&H00FFCC88",      # 暖白光晕
        "outline_color": "&H00333333",    # 灰描边
    },
}

results = []
for tone, cfg in TONES.items():
    name = f"B_{tone}"
    styles = [
        # GlowLayer: Outline=2, 光晕色
        f"Style: GlowLayer,{FONT_NAME},{FS},{cfg['glow_color']},&H000000FF,{cfg['glow_color']},&H00000000,1,0,0,0,100,100,0,0,1,2,0,8,{ML},{MR},{MV},0",
        # Default: Outline=2, 白色文字+色调描边
        f"Style: Default,{FONT_NAME},{FS},&H00FFFFFF,&H000000FF,{cfg['outline_color']},&H00000000,1,0,0,0,100,100,0,0,1,2,0,8,{ML},{MR},{MV},0",
        # Label
        f"Style: Label,{FONT_NAME},18,&H0000FFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,3,0,4,2,20,20,30,0",
    ]
    dlgs = [
        f"Dialogue: 0,0:00:00.00,0:00:10.00,GlowLayer,,0,0,0,,{{{bs}blur3}}{TEXT}",
        f"Dialogue: 1,0:00:00.00,0:00:10.00,Default,,0,0,0,,{TEXT}",
        f"Dialogue: 2,0:00:00.00,0:00:10.00,Label,,0,0,0,,{cfg['label']}  Outline=2 blur=3",
    ]

    ass = f"""[Script Info]
Title: B Scheme Verify - {tone}
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{chr(10).join(styles)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
{chr(10).join(dlgs)}
"""
    ass_path = os.path.join(OUTPUT_DIR, f"verify_{name}.ass")
    img_path = os.path.join(OUTPUT_DIR, f"verify_{name}.png")
    with open(ass_path, 'w', encoding='utf-8') as f:
        f.write(ass)

    fonts_rel = os.path.relpath(FONTS_DIR, OUTPUT_DIR).replace(os.sep, '/')
    vf = f"ass=verify_{name}.ass:fontsdir='{fonts_rel}'"
    cmd = ['ffmpeg', '-y', '-f', 'lavfi', '-i', f'color=c=0x1a1a2e:s={W}x{H}:d=1:r=1',
           '-vf', vf, '-update', '1', '-frames:v', '1', f'verify_{name}.png']
    r = subprocess.run(cmd, capture_output=True, timeout=15, cwd=OUTPUT_DIR)
    if r.returncode == 0 and os.path.exists(img_path):
        print(f"  {name}: OK ({os.path.getsize(img_path)} bytes)")
        results.append(img_path)
    else:
        print(f"  {name}: FAILED")

print(f"\nDone: {len(results)}/3")
