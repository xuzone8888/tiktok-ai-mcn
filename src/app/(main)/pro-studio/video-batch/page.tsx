import { redirect } from "next/navigation";

/**
 * video-batch 大页已消解(S4.4,BLUEPRINT §七):能力全量并入 /studio
 * (omnibox 视频模式 + 批次流 + 任务中心)。旧路由重定向保住外部书签/历史链接。
 *
 * 数据兼容:video-batch store 与统一网关(/api/video-batch/*)原样保留
 * (Studio 视频腿的宿主 store 与提交通道);旧页存留的无 batchId 草稿不再有
 * 执行入口,已提交任务的结果仍在 generations(任务中心可见)。
 * 旧页独有的「任务模板」(creative_templates)UI 随页下线,配方库为其替代;
 * image-batch 的模板 UI 不受影响。
 */
export default function VideoBatchRedirect() {
  redirect("/studio");
}
