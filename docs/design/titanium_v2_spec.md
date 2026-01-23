# Titanium Design System (V2 Gold Master)
> "Industrial Precision. Static Luxury."

This document serves as the **Single Source of Truth** for the Titanium Design System. Any deviation from these values constitutes a design regression.

## 1. Design Philosophy
*   **Physicality**: Interfaces should feel like machined metal, not digital pixels.
*   **Static Precision**: Avoid excessive motion. Use static gradients and noise to convey texture.
*   **Light Control**: Use light (sheen, glow) to indicate state and hierarchy, not wild colors.

## 2. Core Tokens

### Colors (Midnight Palette)
*   **Background**: `#1a1a1a` (Main Card Base)
*   **Surface Overlay**: `rgba(0, 0, 0, 0.2)` (Content Background)
*   **Text Primary**: `#FFFFFF` (100%)
*   **Text Secondary**: `rgba(255, 255, 255, 0.7)` (70%)
*   **Border Highlight**: `rgba(255, 255, 255, 0.8)` (Top-Left Light Source)
*   **Border Shadow**: `rgba(255, 255, 255, 0.2)` (Bottom-Right Shadow)
*   **Active Glow**: `rgba(255, 255, 255, 0.2)` (Pulse Base)

### Typography (Inter + JetBrains Mono)
*   **Font Family**: `Inter`, sans-serif (UI), `JetBrains Mono`, monospace (Data)
*   **Header 1**: 24px / 700 Bold / +0.05em spacing
*   **Subtitle**: 12px / 400 Regular / +0.2em spacing / Uppercase
*   **Data Value**: 14px / Mono / +0.05em spacing
*   **Badge**: 10px / 700 Bold / +0.1em spacing / Uppercase

## 3. Component Specs

### 3.1 Reflective Card (The Core Atom)
A multi-layered component simulating a physical glass/metal slate.

*   **Layer 1 (Noise)**:
    *   `opacity`: 0.75 (Default roughness)
    *   `mix-blend-mode`: overlay
    *   `filter`: Fractal Noise (BaseFreq 0.8)
    *   **Animation**: NONE (Static)

*   **Layer 2 (Sheen)**:
    *   `background`: Linear Gradient (135deg)
    *   `stops`: 40% (10% alpha) -> 50% (0% alpha) -> 60% (10% alpha)
    *   `mix-blend-mode`: overlay
    *   `pointer-events`: none

*   **Layer 3 (Border)**:
    *   `padding`: 1px
    *   `mask-composite`: XOR (To cut out the center)
    *   `background`: Linear Gradient (135deg, 80% alpha -> 20% alpha -> 60% alpha)

### 3.2 Interaction States
*   **Hover**:
    *   Transform: `translateY(-4px)`
    *   Shadow: `0 30px 60px rgba(0,0,0,0.6)`
*   **Active (Standard)**:
    *   `box-shadow`: Inner white glow (`inset 0 0 0 1px rgba(255,255,255,0.5)`)
    *   Sheen: Brightness 1.2

## 4. Implementation Reference
Refer to `src/components/ui/ReflectiveCard.tsx` and `.css` for the canonical implementation.

---
*Created: 2026-01-23*
*Status: LOCKED (Gold Master)*
