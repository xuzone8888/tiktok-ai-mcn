/**
 * 服务端视频时长探测(门B 时长闸兜底,基准首跑修复):
 * ffprobe 直探 OSS URL——只 range 读容器元数据(moov),不整段下载。
 *
 * 失败语义 = 放行(返回 null):主闸在客户端(omnibox 选片即读
 * video.duration 拦截),本探测只为拦住绕过 UI 直打 API、把 270s qwen
 * 预算烧满的异常流量——探测自身出错(网络抖动/怪容器/ffprobe 缺位)时
 * 绝不冤杀正常请求,交给 qwen 135s×2 超时天然兜底。
 *
 * 生产 ffmpeg 6.1.1 + ffprobe 在位(S2.11 部署验证);FFPROBE_CMD 可覆盖
 * (与 local-stitch 同约定)。
 */
import { spawn } from "child_process";

const FFPROBE_CMD = process.env.FFPROBE_CMD || "ffprobe";

export async function probeVideoDurationSec(
  url: string,
  // 实测 OSS 探测 ~2.6s;5s 读不出 moov 的 10s 也读不出,而失败语义本就是
  // 放行——超时预算宁短勿长,别挤占路由 300s 硬墙(审查实锤)
  timeoutMs = 5_000
): Promise<number | null> {
  try {
    const stdout = await new Promise<string | null>((resolve) => {
      const proc = spawn(
        FFPROBE_CMD,
        ["-v", "error", "-print_format", "json", "-show_format", url],
        { stdio: ["ignore", "pipe", "ignore"] }
      );
      let out = "";
      let settled = false;
      const done = (v: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => {
        proc.kill();
        done(null);
      }, timeoutMs);
      proc.stdout.on("data", (d) => {
        out += d.toString();
      });
      proc.on("close", (code) => done(code === 0 ? out : null));
      proc.on("error", () => done(null));
    });
    if (!stdout) return null;
    const data = JSON.parse(stdout) as { format?: { duration?: string } };
    const sec = parseFloat(data.format?.duration ?? "");
    return Number.isFinite(sec) && sec > 0 ? sec : null;
  } catch {
    return null;
  }
}
