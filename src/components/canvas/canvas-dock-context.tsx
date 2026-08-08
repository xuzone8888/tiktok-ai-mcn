"use client";

/**
 * 超级画布 · 底部停靠位(CHECKLIST #189「面板超视口自动 dock 底部」)
 *
 * 生成面板挂在 React Flow 节点里,而节点容器带 `transform` —— CSS 里被 transform 的祖先会成为
 * `position: fixed` 的包含块,所以**不能**靠 fixed 定位把面板钉到视口底部。这里改用 portal:
 * 画布壳在自己的 `relative` 外框里放一个绝对定位的停靠位,面板需要 dock 时 portal 过去。
 *
 * 停靠位由画布壳持有(它知道自己的边界),节点侧只经本 context 拿到宿主元素,不自行找 DOM。
 */
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

const CanvasDockHostContext = createContext<HTMLElement | null>(null);

export function CanvasDockHostProvider({
  host,
  children,
}: {
  host: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <CanvasDockHostContext.Provider value={host}>
      {children}
    </CanvasDockHostContext.Provider>
  );
}

/** 返回底部停靠位元素;null = 画布壳还没挂载好停靠位,调用方应回退到 inline 渲染。 */
export function useCanvasDockHost(): HTMLElement | null {
  return useContext(CanvasDockHostContext);
}
