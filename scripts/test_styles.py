# -*- coding: utf-8 -*-
"""Directly test video generation path to check ASS content."""
import subprocess, tempfile, os, sys, json
sys.stdout.reconfigure(encoding='utf-8')

# Find a test image
imgs = []
for r, d, fs in os.walk(r'E:\TIKTOK-AI\.temp'):
    for f in fs:
        if f.endswith(('.jpg', '.png')):
            imgs.append(os.path.join(r, f))
            if len(imgs) >= 1: break
    if imgs: break

img = imgs[0]

# Simulate the subtitle config that the TS layer sends
subtitle_config = {
    "text": "Cruising with the crew along the coast",
    "style": "trending",
    "tone": "warm",
    "color": "#FFA500",
    "fontSize": 24,
    "fontFamily": "Pacifico",
    "fontWeight": "700",
    "borderWidth": 3,
    "borderColor": "#000000",
    "shadow": True,
    "boxX": 10,
    "boxY": 30,
    "boxWidth": 80,
    "animation": "fade"
}

# Call the Python script in slideshow mode (same as video generation)
od = tempfile.mkdtemp(prefix='vidtest_')
output_path = os.path.join(od, 'test.mp4')

cmd = [
    'python', r'E:\TIKTOK-AI\scripts\ffmpeg-slideshow.py',
    '--images', json.dumps([img]),
    '--output', output_path,
    '--aspect', '9:16',
    '--duration', '3',
    '--transition', 'fade',
    '--subtitle', json.dumps(subtitle_config)
]

print("Running video generation...")
r = subprocess.run(cmd, capture_output=True, text=True, timeout=60, encoding='utf-8', errors='ignore')
print("STDOUT:", r.stdout[-2000:])
if r.returncode != 0:
    print("STDERR:", r.stderr[-1000:])
else:
    print(f"Video generated: {output_path} ({os.path.getsize(output_path)} bytes)")
    
# Now check the ASS content
for root, dirs, files in os.walk(od):
    for f in files:
        if f.endswith('.ass'):
            fp = os.path.join(root, f)
            with open(fp, 'r', encoding='utf-8') as file:
                print(f"\n=== ASS Content ({fp}) ===")
                print(file.read())
