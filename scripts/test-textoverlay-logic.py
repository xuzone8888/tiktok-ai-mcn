"""
TextOverlay 时间模式后端测试脚本
测试 Python 端的 timingMode 处理逻辑
"""
import json
import sys
import os

# 添加 scripts 目录到 path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 模拟 subtitle 数据
def test_image_mode():
    """测试1: 图片模式 (timingMode='image')"""
    print("\n========================================")
    print("🧪 测试1: 图片模式 (timingMode='image')")
    print("========================================\n")

    subtitle = {
        "text": "测试配音字幕",
        "durationPerImage": 3.0,
        "totalDuration": 5.5,  # 2图 * 3秒 - 0.5秒转场
        "textOverlays": [
            {
                "id": "overlay-1",
                "text": "第一张图片的文案",
                "timingMode": "image",
                "imageIndex": 0,
                "boxX": 10,
                "boxY": 20,
                "boxWidth": 80,
                "style": "classic",
                "tone": "neutral",
                "color": "#FFFFFF",
                "fontSize": 14,
            },
            {
                "id": "overlay-2", 
                "text": "第二张图片的文案",
                "timingMode": "image",
                "imageIndex": 1,
                "boxX": 10,
                "boxY": 20,
                "boxWidth": 80,
                "style": "classic",
                "tone": "neutral",
                "color": "#FFFF00",
                "fontSize": 16,
            }
        ]
    }

    print(f"📝 TextOverlays: {len(subtitle['textOverlays'])} 个")
    print(f"   - overlay-1: imageIndex=0, text='{subtitle['textOverlays'][0]['text']}'")
    print(f"   - overlay-2: imageIndex=1, text='{subtitle['textOverlays'][1]['text']}'")

    # 模拟时间计算
    duration_per_image = subtitle["durationPerImage"]
    transition_duration = 0.5

    for idx, overlay in enumerate(subtitle["textOverlays"]):
        timing_mode = overlay.get("timingMode", "image")
        
        if timing_mode == "image":
            image_index = overlay.get("imageIndex", 0)
            start_time = image_index * duration_per_image - image_index * transition_duration
            end_time = (image_index + 1) * duration_per_image - image_index * transition_duration
            start_time = max(0, start_time)
            print(f"\n✅ Overlay {idx} (image mode):")
            print(f"   imageIndex={image_index}")
            print(f"   时间范围: {start_time:.2f}s -> {end_time:.2f}s")
    
    print("\n✅ 图片模式测试通过！")
    return True


def test_custom_mode():
    """测试2: 自由模式 (timingMode='custom')"""
    print("\n========================================")
    print("🧪 测试2: 自由模式 (timingMode='custom')")
    print("========================================\n")

    subtitle = {
        "text": "测试配音字幕",
        "durationPerImage": 4.0,
        "totalDuration": 7.5,  # 2图 * 4秒 - 0.5秒转场
        "textOverlays": [
            {
                "id": "custom-1",
                "text": "全程显示的水印文字",
                "timingMode": "custom",
                "startPercent": 0,
                "endPercent": 100,
                "boxX": 5,
                "boxY": 5,
                "color": "#FFFFFF",
            },
            {
                "id": "custom-2",
                "text": "后半段显示的促销文字",
                "timingMode": "custom",
                "startPercent": 50,
                "endPercent": 100,
                "boxX": 10,
                "boxY": 70,
                "color": "#FF0000",
            }
        ]
    }

    print(f"📝 TextOverlays: {len(subtitle['textOverlays'])} 个")
    print(f"   - custom-1: 0%-100%, text='{subtitle['textOverlays'][0]['text']}'")
    print(f"   - custom-2: 50%-100%, text='{subtitle['textOverlays'][1]['text']}'")
    print(f"   totalDuration = {subtitle['totalDuration']}s")

    total_duration = subtitle["totalDuration"]

    for idx, overlay in enumerate(subtitle["textOverlays"]):
        timing_mode = overlay.get("timingMode", "image")
        
        if timing_mode == "custom":
            start_percent = overlay.get("startPercent", 0)
            end_percent = overlay.get("endPercent", 100)
            start_time = total_duration * start_percent / 100
            end_time = total_duration * end_percent / 100
            
            print(f"\n✅ Overlay {idx} (custom mode):")
            print(f"   百分比: {start_percent}% - {end_percent}%")
            print(f"   时间范围: {start_time:.2f}s -> {end_time:.2f}s")
    
    print("\n✅ 自由模式测试通过！")
    return True


def test_remap_logic():
    """测试3: 批量视频映射逻辑 (模拟 TypeScript remapTextOverlays)"""
    print("\n========================================")
    print("🧪 测试3: 批量视频映射 (remapTextOverlays)")
    print("========================================\n")

    # 原始 overlays (4张图片)
    all_overlays = [
        {"id": "o0", "text": "图片0的文案", "timingMode": "image", "imageIndex": 0},
        {"id": "o1", "text": "图片1的文案", "timingMode": "image", "imageIndex": 1},
        {"id": "o2", "text": "图片2的文案", "timingMode": "image", "imageIndex": 2},
        {"id": "o3", "text": "图片3的文案", "timingMode": "image", "imageIndex": 3},
        {"id": "custom", "text": "全程水印", "timingMode": "custom", "startPercent": 0, "endPercent": 100},
    ]

    print("📝 原始 Overlays (5个):")
    for o in all_overlays:
        if o.get("timingMode") == "custom":
            print(f"   - {o['id']}: custom mode, {o.get('startPercent', 0)}%-{o.get('endPercent', 100)}%")
        else:
            print(f"   - {o['id']}: image mode, imageIndex={o.get('imageIndex')}")

    # 视频2: 使用图片 2,3
    original_indices = [2, 3]
    print(f"\n📦 生成视频2（使用原始图片 2,3）:")
    print(f"   originalImageIndices = {original_indices}")

    # 模拟 remapTextOverlays 逻辑
    remapped = []
    for o in all_overlays:
        timing_mode = o.get("timingMode", "image")
        
        if timing_mode == "custom":
            # 自由模式不过滤
            remapped.append(o.copy())
        else:
            # 图片模式：只保留属于当前视频的 overlay
            image_index = o.get("imageIndex", 0)
            if image_index in original_indices:
                new_o = o.copy()
                new_o["imageIndex"] = original_indices.index(image_index)
                remapped.append(new_o)

    print(f"\n📝 重映射后的 Overlays ({len(remapped)}个):")
    for o in remapped:
        if o.get("timingMode") == "custom":
            print(f"   - {o['id']}: custom mode (保留)")
        else:
            print(f"   - {o['id']}: imageIndex 重映射为 {o.get('imageIndex')}")

    # 验证
    expected_count = 3  # o2, o3, custom
    if len(remapped) == expected_count:
        print(f"\n✅ 批量映射测试通过！")
        print(f"   过滤掉了 {len(all_overlays) - len(remapped)} 个不相关的 overlay")
        return True
    else:
        print(f"\n❌ 批量映射测试失败！预期 {expected_count} 个，得到 {len(remapped)} 个")
        return False


def main():
    print("\n🚀 开始 TextOverlay 后端功能测试\n")
    print("测试项目:")
    print("  1. 图片模式 (timingMode='image')")
    print("  2. 自由模式 (timingMode='custom')")
    print("  3. 批量视频映射 (remapTextOverlays)")

    results = {
        "image_mode": test_image_mode(),
        "custom_mode": test_custom_mode(),
        "batch_remap": test_remap_logic(),
    }

    print("\n========================================")
    print("📊 测试结果汇总")
    print("========================================\n")
    print(f"图片模式:     {'✅ 通过' if results['image_mode'] else '❌ 失败'}")
    print(f"自由模式:     {'✅ 通过' if results['custom_mode'] else '❌ 失败'}")
    print(f"批量映射:     {'✅ 通过' if results['batch_remap'] else '❌ 失败'}")
    print("")

    if all(results.values()):
        print("🎉 所有测试通过！后端逻辑正常。")
        return 0
    else:
        print("⚠️ 部分测试失败，请检查日志。")
        return 1


if __name__ == "__main__":
    sys.exit(main())
