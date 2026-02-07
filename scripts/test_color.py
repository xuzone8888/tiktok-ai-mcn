#!/usr/bin/env python3
"""测试颜色转换"""

def hex_to_ass_color(hex_color):
    """将 #RRGGBB 转换为 ASS 的 &HBBGGRR 格式"""
    if hex_color.startswith('#'):
        hex_color = hex_color[1:]
    if len(hex_color) == 6:
        r, g, b = hex_color[0:2], hex_color[2:4], hex_color[4:6]
        return f"&H00{b}{g}{r}"
    return "&H00FFFFFF"

# 测试颜色
test_colors = [
    ("#EC4899", "粉色 (Pink)"),
    ("#FFD700", "金色 (Gold)"),
    ("#00F2EA", "青色 (Cyan)"),
    ("#FFFFFF", "白色 (White)"),
    ("#FF69B4", "热粉色 (Hot Pink)"),
]

print("=== 颜色转换测试 ===")
print()
for hex_color, name in test_colors:
    ass_color = hex_to_ass_color(hex_color)
    r, g, b = hex_color[1:3], hex_color[3:5], hex_color[5:7]
    print(f"{name}:")
    print(f"  输入: {hex_color} (R={r}, G={g}, B={b})")
    print(f"  ASS:  {ass_color}")
    print()

# 验证粉色
print("=== 粉色验证 ===")
pink = "#EC4899"
print(f"输入: {pink}")
print(f"R=EC (236), G=48 (72), B=99 (153)")
print(f"期望: &H009948EC")
print(f"实际: {hex_to_ass_color(pink)}")
print(f"匹配: {hex_to_ass_color(pink) == '&H009948EC'}")
