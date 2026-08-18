"use client";

/**
 * 超级画布 · 视口尺寸 hook(P0 · S6,#33)
 *
 * 订阅 window resize,给画布壳响应式布局(小地图自动展开/收起、生成面板 dock 决策等)提供当前视口宽高。
 * SSR/首帧无 window 时返回 {0,0},挂载后 effect 立即同步真实尺寸。消费方据 canvas-responsive 的纯策略判定。
 */
import { useEffect, useState } from "react";

export interface ViewportSize {
  width: number;
  height: number;
}

export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(() =>
    typeof window === "undefined"
      ? { width: 0, height: 0 }
      : { width: window.innerWidth, height: window.innerHeight }
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    onResize(); // 挂载即同步(初始 SSR 值/尺寸变化兜底)
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return size;
}
