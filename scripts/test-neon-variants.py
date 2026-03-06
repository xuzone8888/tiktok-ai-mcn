"""
霓虹效果 A/B 测试：6 种方案预览
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

VARIANTS = [
    ("A", "A-柔和紫晕 O1 B4", "&H00F65C8B", 1, 4, 1, "&H0000D4FF", "&H00000000"),
    ("B", "B-霓虹青 O2 B3", "&H00EAF200", 2, 3, 2, "&H00FFFFFF", "&H00804000"),
    ("C", "C-亮粉扩散 O1 B5", "&H009933FF", 1, 5, 1, "&H00FFFFFF", "&H00000000"),
    ("D", "D-锐利紫 O3 B2", "&H00FF4488", 3, 2, 3, "&H00FFFFFF", "&H00000000"),
    ("E", "E-宽晕金字 O0 B6", "&H00F65C8B", 0, 6, 2, "&H0000D4FF", "&H00222222"),
    ("F", "F-双色光晕 O1 B4+B2", "&H00F65C8B", 1, 4, 1, "&H00FFFFFF", "&H00000000"),
]

bs = chr(92)

for name, label, gc, go, gb, do_, dc, doc in VARIANTS:
    styles = [
        f"Style: GlowLayer,{FONT_NAME},{FS},{gc},&H000000FF,{gc},&H00000000,1,0,0,0,100,100,0,0,1,{go},0,8,{ML},{MR},{MV},0",
    ]
    # F 方案：额外加第二个光晕层（青色）
    if name == "F":
        styles.append(f"Style: GlowLayer2,{FONT_NAME},{FS},&H00EAF200,&H000000FF,&H00EAF200,&H00000000,1,0,0,0,100,100,0,0,1,0,0,8,{ML},{MR},{MV},0")

    styles.append(f"Style: Default,{FONT_NAME},{FS},{dc},&H000000FF,{doc},&H00000000,1,0,0,0,100,100,0,0,1,{do_},0,8,{ML},{MR},{MV},0")
    styles.append(f"Style: Label,{FONT_NAME},18,&H0000FFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,3,0,4,2,20,20,30,0")

    dlgs = [
        f"Dialogue: 0,0:00:00.00,0:00:10.00,GlowLayer,,0,0,0,,{{{bs}blur{gb}}}{TEXT}",
    ]
    if name == "F":
        dlgs.append(f"Dialogue: 0,0:00:00.00,0:00:10.00,GlowLayer2,,0,0,0,,{{{bs}blur2}}{TEXT}")
    dlgs.append(f"Dialogue: 1,0:00:00.00,0:00:10.00,Default,,0,0,0,,{TEXT}")
    dlgs.append(f"Dialogue: 2,0:00:00.00,0:00:10.00,Label,,0,0,0,,{label}")

    ass = f"""[Script Info]
Title: Neon Test {name}
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
    ass_path = os.path.join(OUTPUT_DIR, f"neon_{name}.ass")
    img_path = os.path.join(OUTPUT_DIR, f"neon_{name}.png")
    with open(ass_path, 'w', encoding='utf-8') as f:
        f.write(ass)

    # Render using cwd = OUTPUT_DIR for relative paths
    fonts_rel = os.path.relpath(FONTS_DIR, OUTPUT_DIR).replace(os.sep, '/')
    vf = f"ass=neon_{name}.ass:fontsdir='{fonts_rel}'"
    cmd = ['ffmpeg', '-y', '-f', 'lavfi', '-i', f'color=c=0x1a1a2e:s={W}x{H}:d=1:r=1', '-vf', vf, '-update', '1', '-frames:v', '1', f'neon_{name}.png']
    r = subprocess.run(cmd, capture_output=True, timeout=15, cwd=OUTPUT_DIR)
    if r.returncode == 0 and os.path.exists(img_path):
        print(f"  {name}: OK ({os.path.getsize(img_path)} bytes)")
    else:
        err = r.stderr.decode('utf-8', errors='replace') if r.stderr else ''
        # Find error lines
        for line in err.split('\n'):
            if 'rror' in line:
                print(f"  {name}: FAIL - {line.strip()[:120]}")
                break
        else:
            print(f"  {name}: FAIL (code={r.returncode})")

print("\nDone! Check:", OUTPUT_DIR)
