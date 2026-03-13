#!/bin/bash
# ============================================
# VideoToolbox vs libx264 对比测试脚本
# 在 Mac Studio 上运行，自动生成两个视频并对比
# ============================================

set -e

echo "🎬 VideoToolbox vs libx264 对比测试"
echo "===================================="

# 检查 FFmpeg 是否支持 VideoToolbox
if ! ffmpeg -encoders 2>/dev/null | grep -q videotoolbox; then
    echo "❌ FFmpeg 不支持 VideoToolbox，请重新安装："
    echo "   brew install ffmpeg"
    exit 1
fi
echo "✅ FFmpeg 支持 VideoToolbox"

# 创建测试目录
TEST_DIR="$(dirname "$0")/.temp/vtb_test"
mkdir -p "$TEST_DIR"

# 查找项目中的已有图片（用真实素材测试更有说服力）
SCRIPT_DIR="$(dirname "$0")"
IMG_DIR="$SCRIPT_DIR/.temp/slideshow"

# 如果没有现有图片，用 FFmpeg 生成测试图
echo ""
echo "📸 准备测试图片..."

for i in 1 2 3 4 5; do
    IMG="$TEST_DIR/img_${i}.jpg"
    if [ ! -f "$IMG" ]; then
        # 生成 1080x1920 彩色渐变测试图（模拟真实竖版图片）
        ffmpeg -y -f lavfi -i "color=c=#$(printf '%02x%02x%02x' $((i*50)) $((255-i*40)) $((i*30))):s=1080x1920:d=1" \
            -vf "drawtext=text='Test Image ${i}':fontsize=80:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:borderw=3:bordercolor=black,\
drawtext=text='ToryX AI MCN':fontsize=40:fontcolor=#FFD700:x=(w-text_w)/2:y=h*0.7:borderw=2:bordercolor=black" \
            -vframes 1 "$IMG" 2>/dev/null
    fi
done
echo "✅ 5 张测试图片就绪"

# 查找 BGM
BGM=""
if [ -d "$SCRIPT_DIR/bgm" ]; then
    BGM=$(find "$SCRIPT_DIR/bgm" -name "*.mp3" | head -1)
fi

# ============================================
# 测试 1: libx264 (当前方案)
# ============================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔵 测试 A: libx264 (当前编码器)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

OUTPUT_X264="$TEST_DIR/output_libx264.mp4"
INPUTS=""
FILTER=""
for i in 1 2 3 4 5; do
    INPUTS="$INPUTS -loop 1 -t 2 -i $TEST_DIR/img_${i}.jpg"
done

# 构建 xfade 转场滤镜 (与你的 Python 脚本一致)
FILTER="[0:v]scale=1080:1920,setsar=1[v0];[1:v]scale=1080:1920,setsar=1[v1];[2:v]scale=1080:1920,setsar=1[v2];[3:v]scale=1080:1920,setsar=1[v3];[4:v]scale=1080:1920,setsar=1[v4];"
FILTER="${FILTER}[v0][v1]xfade=transition=fade:duration=0.5:offset=1.5[f01];"
FILTER="${FILTER}[f01][v2]xfade=transition=fade:duration=0.5:offset=3.0[f02];"
FILTER="${FILTER}[f02][v3]xfade=transition=fade:duration=0.5:offset=4.5[f03];"
FILTER="${FILTER}[f03][v4]xfade=transition=fade:duration=0.5:offset=6.0[outv]"

START_X264=$(python3 -c "import time; print(time.time())")

eval ffmpeg -y $INPUTS \
    -filter_complex "$FILTER" \
    -map "[outv]" \
    -c:v libx264 -preset fast -crf 23 \
    -pix_fmt yuv420p \
    -color_range pc -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
    -an \
    "$OUTPUT_X264" 2>/dev/null

END_X264=$(python3 -c "import time; print(time.time())")
TIME_X264=$(python3 -c "print(f'{$END_X264 - $START_X264:.2f}')")
SIZE_X264=$(ls -lh "$OUTPUT_X264" | awk '{print $5}')

echo "⏱  耗时: ${TIME_X264}s"
echo "📦 大小: $SIZE_X264"
echo "📄 文件: $OUTPUT_X264"

# ============================================
# 测试 2: h264_videotoolbox (硬件加速)
# ============================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🟢 测试 B: h264_videotoolbox (硬件)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

OUTPUT_VTB="$TEST_DIR/output_videotoolbox.mp4"

START_VTB=$(python3 -c "import time; print(time.time())")

eval ffmpeg -y $INPUTS \
    -filter_complex "$FILTER" \
    -map "[outv]" \
    -c:v h264_videotoolbox -q:v 65 \
    -pix_fmt yuv420p \
    -color_range pc -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
    -an \
    "$OUTPUT_VTB" 2>/dev/null

END_VTB=$(python3 -c "import time; print(time.time())")
TIME_VTB=$(python3 -c "print(f'{$END_VTB - $START_VTB:.2f}')")
SIZE_VTB=$(ls -lh "$OUTPUT_VTB" | awk '{print $5}')

echo "⏱  耗时: ${TIME_VTB}s"
echo "📦 大小: $SIZE_VTB"
echo "📄 文件: $OUTPUT_VTB"

# ============================================
# 对比结果
# ============================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 对比结果"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

SPEEDUP=$(python3 -c "
x264 = $TIME_X264
vtb = $TIME_VTB
speedup = x264 / vtb if vtb > 0 else 0
print(f'''
┌──────────────────┬──────────────┬──────────────────┐
│                  │   libx264    │  VideoToolbox    │
├──────────────────┼──────────────┼──────────────────┤
│ 渲染耗时         │   {x264:.2f}s      │   {vtb:.2f}s           │
│ 速度比           │   1.0x       │   {speedup:.1f}x            │
│ 文件大小         │   $SIZE_X264        │   $SIZE_VTB            │
└──────────────────┴──────────────┴──────────────────┘

🎬 VideoToolbox 比 libx264 快 {speedup:.1f} 倍
📂 输出文件在: $TEST_DIR/
   → 用 QuickLook 或 IINA 打开两个视频对比画质
')
")
echo "$SPEEDUP"
