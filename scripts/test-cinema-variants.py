"""
影视(cinema)字幕效果 5 种方案预览
同时测试不同字号以找到最佳大小
"""
import subprocess, os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUTPUT_DIR = os.path.join(BASE, '.temp', 'neon_test')
FONTS_DIR = os.path.join(BASE, 'public', 'fonts', 'NotoSansSC')
os.makedirs(OUTPUT_DIR, exist_ok=True)

FONT_NAME = "Noto Sans SC"
TEXT = "治愈瞬间，心都化了"
W, H = 540, 960
ML, MR, MV = 60, 60, 80  # 顶部定位模拟 TextOverlay
bs = chr(92)

# 5 种影视方案
VARIANTS = [
    {
        "name": "A",
        "label": "A-当前cinema",
        "desc": "bord1 shadow2 spacing4 细体",
        "fs": 38,
        "outline": "&H00000000",
        "border_width": 1,
        "shadow": 2,
        "back": "&H60000000",
        "spacing": 4,
        "bold": 0,
    },
    {
        "name": "B",
        "label": "B-电影黄字",
        "desc": "bord2 shadow1 spacing2 粗体 暖黄",
        "fs": 42,
        "color": "&H0000CCFF",  # 暖黄
        "outline": "&H00000000",
        "border_width": 2,
        "shadow": 1,
        "back": "&H80000000",
        "spacing": 2,
        "bold": 1,
    },
    {
        "name": "C",
        "label": "C-极简白",
        "desc": "bord0 shadow3 spacing6 细体 纯投影",
        "fs": 40,
        "outline": "&H00000000",
        "border_width": 0,
        "shadow": 3,
        "back": "&HA0000000",
        "spacing": 6,
        "bold": 0,
    },
    {
        "name": "D",
        "label": "D-描边加强",
        "desc": "bord2 shadow0 spacing3 粗体 清晰",
        "fs": 40,
        "outline": "&H00222222",
        "border_width": 2,
        "shadow": 0,
        "back": "&H00000000",
        "spacing": 3,
        "bold": 1,
    },
    {
        "name": "E",
        "label": "E-半透明底条",
        "desc": "BS3 半透明底 spacing3 粗体",
        "fs": 40,
        "outline": "&H00000000",
        "border_style": 3,
        "border_width": 0,
        "shadow": 0,
        "back": "&H80000000",
        "spacing": 3,
        "bold": 1,
        "extra_tag": r'{\xbord12\ybord5\4a&H40&}',  # 内边距+半透明
    },
]

results = []
for v in VARIANTS:
    name = f"cinema_{v['name']}"
    fs = v['fs']
    color = v.get('color', '&H00FFFFFF')
    bs_val = v.get('border_style', 1)
    extra = v.get('extra_tag', '')

    styles = [
        f"Style: Default,{FONT_NAME},{fs},{color},&H000000FF,{v['outline']},{v['back']},{v['bold']},0,0,0,100,100,{v['spacing']},0,{bs_val},{v['border_width']},{v['shadow']},8,{ML},{MR},{MV},0",
        f"Style: Label,{FONT_NAME},16,&H0000FFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,3,0,4,2,20,20,20,0",
    ]
    dlgs = [
        f"Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{extra}{TEXT}",
        f"Dialogue: 1,0:00:00.00,0:00:10.00,Label,,0,0,0,,{v['label']}  ({v['desc']})",
    ]

    ass = f"""[Script Info]
Title: Cinema Test {v['name']}
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
    ass_path = os.path.join(OUTPUT_DIR, f"{name}.ass")
    img_path = os.path.join(OUTPUT_DIR, f"{name}.png")
    with open(ass_path, 'w', encoding='utf-8') as f:
        f.write(ass)

    fonts_rel = os.path.relpath(FONTS_DIR, OUTPUT_DIR).replace(os.sep, '/')
    vf = f"ass={name}.ass:fontsdir='{fonts_rel}'"
    cmd = ['ffmpeg', '-y', '-f', 'lavfi', '-i', f'color=c=0x1a1a2e:s={W}x{H}:d=1:r=1',
           '-vf', vf, '-update', '1', '-frames:v', '1', f'{name}.png']
    r = subprocess.run(cmd, capture_output=True, timeout=15, cwd=OUTPUT_DIR)
    if r.returncode == 0 and os.path.exists(img_path):
        print(f"  {v['name']}: OK ({os.path.getsize(img_path)} bytes)")
        results.append(img_path)
    else:
        err = r.stderr.decode('utf-8', errors='replace') if r.stderr else ''
        for line in err.split('\n'):
            if 'rror' in line:
                print(f"  {v['name']}: FAIL - {line.strip()[:120]}")
                break
        else:
            print(f"  {v['name']}: FAIL")

print(f"\nDone: {len(results)}/5")
