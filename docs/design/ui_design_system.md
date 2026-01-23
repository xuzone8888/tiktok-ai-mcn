# ToryX UI 设计规范 (Design System)

> 基于 ReactBits Titanium 风格的完整设计系统
> 最后更新: 2026-01-23

---

## 1. 色彩系统 (Color Palette)

### 1.1 基础色 (Base Colors)
```css
/* 背景色 */
--color-background: #000000;           /* 页面背景 - 纯黑 */
--color-surface: #1a1a1a;              /* 卡片/容器背景 - 深灰 */
--color-surface-elevated: #1f1f23;     /* 提升层背景 - 稍亮 */
--color-surface-overlay: #27272a;      /* 叠加层背景 - Zinc-800 */

/* 文字色 */
--color-text-primary: #ffffff;         /* 主文字 - 纯白 */
--color-text-secondary: #a1a1aa;       /* 次要文字 - Zinc-400 */
--color-text-muted: #71717a;           /* 辅助文字 - Zinc-500 */
--color-text-disabled: #52525b;        /* 禁用文字 - Zinc-600 */

/* 边框色 */
--color-border: rgba(255, 255, 255, 0.1);      /* 默认边框 */
--color-border-hover: rgba(255, 255, 255, 0.2); /* 悬停边框 */
--color-border-active: rgba(255, 255, 255, 0.3); /* 激活边框 */
```

### 1.2 品牌色 (Brand Colors)
```css
/* TikTok 霓虹色 */
--color-tiktok-cyan: #00f2ea;
--color-tiktok-pink: #ff0050;

/* 状态色 */
--color-success: #10b981;              /* Emerald-500 */
--color-success-bg: rgba(16, 185, 129, 0.1);
--color-success-border: rgba(16, 185, 129, 0.3);

--color-error: #ef4444;                /* Red-500 */
--color-error-bg: rgba(239, 68, 68, 0.1);
--color-error-border: rgba(239, 68, 68, 0.3);
```

---

## 2. ReflectiveCard 组件参数

### 2.1 TSX Props
```tsx
interface ReflectiveCardProps {
    metalness?: number;      // 光泽度 (0-1), 默认: 1
    roughness?: number;      // 粗糙度 (0-1), 默认: 0.5
    overlayColor?: string;   // 内容遮罩, 默认: 'rgba(255, 255, 255, 0.08)'
    color?: string;          // 文字颜色, 默认: '#ffffff'
    active?: boolean;        // 脉冲动画, 默认: false
    className?: string;      // 允许 Tailwind 覆盖圆角等
}
```

### 2.2 CSS 关键变量
```css
/* 容器 */
.reflective-card-container {
    background: #1a1a1a;
    border-radius: 20px;                              /* 默认圆角，可被 Tailwind 覆盖 */
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);      /* 投影，无内描边 */
    overflow: hidden;
}

/* 噪点纹理层 */
.reflective-noise {
    opacity: var(--roughness, 0.5);
    background-size: 200px 200px;                     /* 固定尺寸防止大卡片拉伸 */
    background-repeat: repeat;
    mix-blend-mode: overlay;
}

/* 金属光泽层 */
.reflective-sheen {
    background: linear-gradient(135deg,
        rgba(255, 255, 255, 0.4) 0%,
        rgba(255, 255, 255, 0.1) 40%,
        rgba(255, 255, 255, 0) 50%,
        rgba(255, 255, 255, 0.1) 60%,
        rgba(255, 255, 255, 0.3) 100%);
    mix-blend-mode: overlay;
    opacity: var(--metalness, 1);
}

/* 渐变边框层 */
.reflective-border {
    border-radius: inherit;                           /* 继承容器圆角 */
    padding: 1px;
    background: linear-gradient(135deg,
        rgba(255, 255, 255, 0.8) 0%,
        rgba(255, 255, 255, 0.2) 50%,
        rgba(255, 255, 255, 0.6) 100%);
    /* mask-composite 技术实现镂空边框 */
}

/* 内容层 */
.reflective-content {
    background: var(--overlay-color, rgba(255, 255, 255, 0.08));
}
```

---

## 3. 按钮样式

### 3.1 主按钮 (Primary - 白色发光)
```tsx
<button className="
    bg-gradient-to-b from-white to-gray-100 
    text-black 
    px-6 py-3 
    rounded-xl 
    font-medium 
    flex items-center 
    shadow-[0_0_20px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,1)] 
    hover:shadow-[0_0_25px_rgba(255,255,255,0.5),inset_0_1px_0_rgba(255,255,255,1)] 
    transition-all duration-300 
    border-t border-white
">
    按钮文字
    <ArrowRight className="h-4 w-4 ml-2" />
</button>
```

### 3.2 次要按钮 (Secondary - 透明边框)
```tsx
<Button
    variant="outline"
    className="h-14 px-8 text-lg border-white/20 text-white hover:bg-white/10"
>
    次要操作
</Button>
```

### 3.3 幽灵按钮 (Ghost)
```tsx
<Button
    variant="ghost"
    className="text-gray-300 hover:text-white hover:bg-white/10"
>
    幽灵按钮
</Button>
```

---

## 4. 圆角规范 (Border Radius)

```css
/* Tailwind 类名 → 实际值 */
rounded-sm   = 0.125rem (2px)
rounded      = 0.25rem  (4px)
rounded-md   = 0.375rem (6px)
rounded-lg   = 0.5rem   (8px)
rounded-xl   = 0.75rem  (12px)   ← 小组件、徽章
rounded-2xl  = 1rem     (16px)   ← 输入框、FAQ 项
rounded-3xl  = 1.5rem   (24px)   ← 大卡片
rounded-full = 9999px             ← 胶囊形
```

### 使用建议
| 场景 | 推荐 |
|---|---|
| 小徽章/按钮 | `rounded-lg` 或 `rounded-xl` |
| 输入框/表单 | `rounded-2xl` |
| 大卡片/区块 | `rounded-3xl` |
| 导航标签 | `rounded-full` |

---

## 5. 阴影规范 (Box Shadow)

```css
/* 卡片投影 */
--shadow-card: 0 10px 30px rgba(0, 0, 0, 0.5);
--shadow-card-hover: 0 30px 60px rgba(0, 0, 0, 0.6);

/* 发光效果 */
--glow-white-soft: 0 0 20px rgba(255, 255, 255, 0.3);
--glow-white-strong: 0 0 25px rgba(255, 255, 255, 0.5);

/* 内高光 (按钮顶部) */
--highlight-top: inset 0 1px 0 rgba(255, 255, 255, 1);
```

---

## 6. 动画规范 (Animation)

### 6.1 脉冲动画 (Active Card)
```css
@keyframes card-pulse {
    0%   { box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5); }
    50%  { box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), 0 0 20px rgba(255, 255, 255, 0.2); }
    100% { box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5); }
}
/* 持续时间: 3s, 无限循环 */
```

### 6.2 过渡时间
```css
--transition-fast: 0.15s ease;
--transition-normal: 0.3s ease;
--transition-slow: 0.5s cubic-bezier(0.4, 0, 0.2, 1);
```

---

## 7. 字体规范 (Typography)

### 7.1 字体家族
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
font-family-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### 7.2 字号层级
| 用途 | 大小 | 类名 |
|---|---|---|
| 超大标题 (Hero) | 5rem (80px) | `text-7xl` |
| 大标题 | 3rem (48px) | `text-5xl` |
| 中标题 | 2.25rem (36px) | `text-4xl` |
| 小标题 | 1.5rem (24px) | `text-2xl` |
| 正文 | 1rem (16px) | `text-base` |
| 辅助说明 | 0.875rem (14px) | `text-sm` |
| 标签/徽章 | 0.75rem (12px) | `text-xs` |
| 微型标签 | 0.625rem (10px) | `text-[10px]` |

---

## 8. 间距规范 (Spacing)

### 8.1 常用间距
```
p-2   = 0.5rem  (8px)   ← 紧凑内边距
p-4   = 1rem    (16px)  ← 标准内边距
p-6   = 1.5rem  (24px)  ← 卡片内边距
p-8   = 2rem    (32px)  ← 大区块内边距
p-12  = 3rem    (48px)  ← 超大区块

gap-2 = 0.5rem  (8px)   ← 紧凑间隙
gap-4 = 1rem    (16px)  ← 标准间隙
gap-6 = 1.5rem  (24px)  ← 卡片间隙
gap-8 = 2rem    (32px)  ← 区块间隙
```

### 8.2 Section 间距
```tsx
<section className="relative z-10 py-24">
    {/* 标准 section 上下边距: py-24 = 6rem (96px) */}
</section>
```

---

## 9. 使用示例

### 9.1 标准 ReflectiveCard
```tsx
<ReflectiveCard className="!rounded-3xl">
    <div className="p-8">
        {/* 内容 */}
    </div>
</ReflectiveCard>
```

### 9.2 激活状态卡片 (带脉冲)
```tsx
<ReflectiveCard className="!rounded-2xl" active={true}>
    <div className="p-6">
        {/* 内容 */}
    </div>
</ReflectiveCard>
```

### 9.3 内部元素色彩一致性
```tsx
{/* 内部占位框/格子 */}
<div className="bg-[#27272a] border border-white/10 rounded-xl">
    {/* 暖灰底色 */}
</div>

{/* 更深的内部元素 */}
<div className="bg-[#1f1f23] border border-white/10 rounded-lg">
    {/* 深灰底色 */}
</div>
```

---

## 10. 注意事项

1. **圆角覆盖**: 使用 `!rounded-*` 强制覆盖默认 `20px` 圆角。
2. **边框层继承**: `.reflective-border` 会自动继承容器圆角。
3. **避免双边框**: 不要同时使用 `box-shadow inset` 和 `.reflective-border`。
4. **噪点尺寸**: 噪点纹理固定 `200px` 平铺，防止大卡片拉伸。
5. **白色遮罩**: 内容层使用 `rgba(255,255,255,0.08)` 白色微光，不是黑色。

---

*此文档为 ToryX 项目官方设计规范，所有新组件/页面应遵循此规范以保持视觉一致性。*
