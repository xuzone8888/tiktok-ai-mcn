# ReactBits Titanium 原版设计规范 (ID Card Style)

> 来源：ReactBits 官方 Titanium Card 组件
> 最后更新: 2026-01-24

---

## 0. 官方参数表 (Props)

| 属性 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| **模糊力量 (blurStrength)** | number | `12` | 模糊效果的强度 (0-20像素) |
| **金属性 (metalness)** | number | `1` | 金属光泽的不透明度 (0-1) |
| **粗糙度 (roughness)** | number | `0.4` | 噪声纹理的不透明度 (0-1) |
| **位移强度 (displacementStrength)** | number | `20` | 位移强度（变形程度）|
| **噪音尺度 (noiseScale)** | number | `1` | 噪声纹理的尺度（波纹大小）|
| **高光常数 (specularConstant)** | number | `1.2` | 光照（光泽度）的镜面常数 |
| **灰度 (saturation)** | number | `1` | 灰度强度 (0-1) |
| **玻璃失真 (glassDistortion)** | number | `0` | 玻璃边缘变形的强度 |
| **颜色 (color)** | string | `白色` | 基础文本颜色 |
| **覆盖色 (overlayColor)** | string | `rgba(255,255,255,0.1)` | 覆盖色调的颜色 |

---

## 1. 容器 (.reflective-card-container)

```css
.reflective-card-container {
  position: relative;
  width: 320px;
  height: 500px;
  border-radius: 20px;
  overflow: hidden;
  background: #1a1a1a;
  box-shadow:
    0 20px 50px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset;  /* 关键：内边框 */
  isolation: isolate;
  font-family: 'Inter', sans-serif;
}
```

**关键点**：
- `box-shadow` 包含 `inset` 创建细微的内边框
- `isolation: isolate` 防止 blend-mode 溢出

---

## 2. 噪点层 (.reflective-noise)

```css
.reflective-noise {
  position: absolute;
  inset: 0;
  z-index: 1;
  opacity: var(--roughness, 0.4);  /* 默认 0.4，不要太高 */
  pointer-events: none;
  background-image: url("data:image/svg+xml,...");
  mix-blend-mode: overlay;  /* 原版是 overlay */
}
```

**关键点**：
- `mix-blend-mode: overlay`（不是 soft-light）
- 默认 `opacity: 0.4`，保持微妙

---

## 3. 金属光泽层 (.reflective-sheen)

```css
.reflective-sheen {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.4) 0%,
    rgba(255, 255, 255, 0.1) 40%,
    rgba(255, 255, 255, 0) 50%,
    rgba(255, 255, 255, 0.1) 60%,
    rgba(255, 255, 255, 0.3) 100%
  );
  pointer-events: none;
  mix-blend-mode: overlay;
  opacity: var(--metalness, 1);
}
```

---

## 4. 渐变边框层 (.reflective-border)

```css
.reflective-border {
  position: absolute;
  inset: 0;
  border-radius: 20px;
  padding: 1px;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.8) 0%,
    rgba(255, 255, 255, 0.2) 50%,
    rgba(255, 255, 255, 0.6) 100%
  );
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
  z-index: 20;
  pointer-events: none;
}
```

---

## 5. 内容层布局

### Header
```css
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: 16px;
}
```

### Footer
```css
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  padding-top: 24px;
}
```

---

## 6. 排版

| 元素 | 样式 |
|------|------|
| 用户名 | `24px / 700 / 0.05em` |
| 角色 | `12px / 0.2em / uppercase / 0.7 opacity` |
| 标签 | `9px / 0.1em / 0.6 opacity` |
| 数值 | `14px / monospace / 0.05em` |
| 徽章 | `10px / 700 / 0.1em / uppercase` |

---

*此规范为 ReactBits Titanium 原版样式的完整记录。*
