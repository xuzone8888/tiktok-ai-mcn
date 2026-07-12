import { CanvasRoot } from "@/components/canvas/canvas-root";

/**
 * /canvas 路由入口(P0 · S1)。
 *
 * 薄 server 入口:所有交互在客户端 <CanvasRoot>。鉴权由中间件负责(硬鉴权,登出跳
 * /auth/login),不在页面内重复。P0 内部骨架:空画布 + 完整底盘;建节点(S2)前无内容创建。
 */
export default function CanvasPage() {
  return <CanvasRoot />;
}
