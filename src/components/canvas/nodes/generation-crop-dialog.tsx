"use client";

/**
 * 产物裁剪弹层(CHECKLIST #82「图片工具条:裁剪」)
 *
 * **纯前端**:像素处理全在浏览器里做,不调任何生成接口、**不产生任何扣费**。
 * 产出一个 JPEG Blob 交给调用方,由调用方走画布已有的上传链路落成新节点
 * (见 `generation-controls.tsx` 的裁剪按钮)。
 *
 * ## 两个必须守住的实现约束
 *
 * 1. **`crossOrigin="anonymous"` 不能删。** 产物图在 `media.toryxai.com`(OSS),
 *    与站点不同源。不带这个属性画到 `<canvas>` 上会**污染画布**,`toBlob` 直接抛
 *    `SecurityError`。已实测该 bucket 回 `Access-Control-Allow-Origin: *`
 *    与 `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`,所以带上就能用。
 *    真遇到跨域失败也不静默——`onError` 会把弹层切到出错态并给出人话原因。
 *
 * 2. **裁剪按原图像素算,不按显示像素算。** 展示区被 `max-h`/`max-w` 压过,
 *    直接拿鼠标坐标当像素会得到一张比原图小得多的图。故所有选区以
 *    **0-1 归一化比例**存,导出时再乘 `naturalWidth/naturalHeight`。
 *
 * 选区交互刻意做薄(拖一个矩形 + 重选 + 全选),不做八向把手:
 * 画布的裁剪是「切掉多余的边」,不是修图工作台;把手会显著抬高实现与维护成本。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** 归一化选区(0-1),与显示尺寸无关。 */
export interface NormalizedCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 低于这个比例的选区当成误触,不给导出——否则会得到 1×1 像素的“图”。 */
const MIN_CROP_RATIO = 0.02;

const FULL_RECT: NormalizedCropRect = { x: 0, y: 0, width: 1, height: 1 };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number }
): NormalizedCropRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * 按归一化选区把 `<img>` 裁成 JPEG Blob。
 *
 * 导出为 JPEG 而非 PNG 是有意的:画布上传契约允许 jpg/png/webp/gif,但**图片上限 10MB**
 * (`CANVAS_UPLOAD_MAX_IMAGE_BYTES`),而 4K 产物裁一大块导成 PNG 很容易越线;
 * 产物本身也是 jpg,转 PNG 只会变大不会变清楚。
 */
export async function cropImageToJpegBlob(
  image: HTMLImageElement,
  rect: NormalizedCropRect
): Promise<Blob> {
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("图片尚未加载完成");
  }

  const sx = Math.round(clamp01(rect.x) * sourceWidth);
  const sy = Math.round(clamp01(rect.y) * sourceHeight);
  const sw = Math.max(1, Math.round(clamp01(rect.width) * sourceWidth));
  const sh = Math.max(1, Math.round(clamp01(rect.height) * sourceHeight));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持画布裁剪");
  context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        // 跨域污染会走到这里(toBlob 抛 SecurityError 时部分实现回 null)。
        else reject(new Error("裁剪失败：浏览器拒绝导出该图片"));
      },
      "image/jpeg",
      0.92
    );
  });
}

export function GenerationCropDialog({
  open,
  onOpenChange,
  mediaUrl,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediaUrl: string | null | undefined;
  /** 上传在途时锁住确认键,避免重复落节点。 */
  busy?: boolean;
  onConfirm: (blob: Blob) => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);

  const [rect, setRect] = useState<NormalizedCropRect>(FULL_RECT);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // 每次开合都回到干净状态:留着上一张图的选区会让用户以为裁的是这一张。
  useEffect(() => {
    if (open) return;
    setRect(FULL_RECT);
    setLoaded(false);
    setLoadError(false);
    setExporting(false);
    setExportError(null);
    dragOriginRef.current = null;
  }, [open]);

  const pointFromEvent = useCallback((event: React.PointerEvent) => {
    const frame = frameRef.current;
    if (!frame) return null;
    const bounds = frame.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      x: clamp01((event.clientX - bounds.left) / bounds.width),
      y: clamp01((event.clientY - bounds.top) / bounds.height),
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!loaded || loadError) return;
      const point = pointFromEvent(event);
      if (!point) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragOriginRef.current = point;
      setRect({ x: point.x, y: point.y, width: 0, height: 0 });
      setExportError(null);
    },
    [loaded, loadError, pointFromEvent]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const origin = dragOriginRef.current;
      if (!origin) return;
      const point = pointFromEvent(event);
      if (!point) return;
      setRect(rectFromPoints(origin, point));
    },
    [pointFromEvent]
  );

  const endDrag = useCallback((event: React.PointerEvent) => {
    if (!dragOriginRef.current) return;
    dragOriginRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const tooSmall =
    rect.width < MIN_CROP_RATIO || rect.height < MIN_CROP_RATIO;

  const handleConfirm = useCallback(() => {
    const image = imageRef.current;
    if (!image || tooSmall) return;
    setExporting(true);
    setExportError(null);
    void cropImageToJpegBlob(image, rect)
      .then((blob) => {
        onConfirm(blob);
      })
      .catch((error: unknown) => {
        setExportError(
          error instanceof Error ? error.message : "裁剪失败，请重试"
        );
      })
      .finally(() => setExporting(false));
  }, [onConfirm, rect, tooSmall]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(92vw,60rem)] p-3">
        <DialogHeader>
          <DialogTitle className="text-sm">裁剪图片</DialogTitle>
          <DialogDescription className="text-[11px]">
            在图上拖一个矩形选出要保留的部分。裁剪只在你的浏览器里完成，
            <strong className="font-medium">不消耗积分</strong>；确认后会把结果作为一个新的图片节点放到画布上，原图不受影响。
          </DialogDescription>
        </DialogHeader>

        {mediaUrl && !loadError ? (
          <div
            ref={frameRef}
            className="relative mx-auto w-fit touch-none select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 签名 URL 是瞬态的，不能进 next/image 的优化缓存 */}
            <img
              ref={imageRef}
              src={mediaUrl}
              alt="待裁剪的生成产物"
              crossOrigin="anonymous"
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => setLoadError(true)}
              className="max-h-[60vh] max-w-full object-contain"
            />
            {loaded && !tooSmall ? (
              // 选区外压暗用**四块遮罩**,不用「整块压暗 + 想办法把选区抠回来」:
              // 后者要么再加载一张同图(多一次网络与内存),要么依赖 box-shadow 撑满视口的偏方。
              // 四块遮罩是纯几何,零额外资源,且选区内像素**原样**呈现——所见即所裁。
              <>
                {[
                  { left: 0, top: 0, width: 1, height: rect.y },
                  {
                    left: 0,
                    top: rect.y + rect.height,
                    width: 1,
                    height: 1 - rect.y - rect.height,
                  },
                  { left: 0, top: rect.y, width: rect.x, height: rect.height },
                  {
                    left: rect.x + rect.width,
                    top: rect.y,
                    width: 1 - rect.x - rect.width,
                    height: rect.height,
                  },
                ].map((mask, index) => (
                  <div
                    key={index}
                    className="pointer-events-none absolute bg-background/65"
                    style={{
                      left: `${mask.left * 100}%`,
                      top: `${mask.top * 100}%`,
                      width: `${Math.max(0, mask.width) * 100}%`,
                      height: `${Math.max(0, mask.height) * 100}%`,
                    }}
                  />
                ))}
                <div
                  className="pointer-events-none absolute border-2 border-primary"
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.width * 100}%`,
                    height: `${rect.height * 100}%`,
                  }}
                />
              </>
            ) : null}
          </div>
        ) : (
          <p className="py-8 text-center text-xs text-muted-foreground">
            {mediaUrl
              ? "图片加载失败，无法裁剪。可能是预览链接已过期，关掉面板重新打开再试。"
              : "没有可裁剪的产物。"}
          </p>
        )}

        {exportError ? (
          <p className="text-[11px] text-destructive">{exportError}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {tooSmall
              ? "还没选区域：在图上按住并拖动即可。"
              : `已选 ${Math.round(rect.width * 100)}% × ${Math.round(rect.height * 100)}% 的区域。`}
          </p>
        )}

        <DialogFooter className="gap-1.5 sm:gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={!loaded || loadError}
            onClick={() => setRect(FULL_RECT)}
          >
            全选
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            disabled={!loaded || loadError || tooSmall || exporting || busy}
            onClick={handleConfirm}
          >
            {exporting || busy ? "处理中…" : "裁剪并新建节点"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
