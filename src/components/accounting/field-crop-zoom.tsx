"use client";

import { useEffect, useRef } from "react";
import type { InvoiceCropBox } from "@/components/accounting/invoice-image-viewer";

/**
 * 同一張發票會反覆 focus 不同欄位，點陣圖只抓一次；
 * 最多留幾張避免長時間審核吃記憶體（舊的交給 GC）。
 */
const bitmapCache = new Map<string, Promise<ImageBitmap>>();
const BITMAP_CACHE_LIMIT = 4;

function loadBitmap(src: string): Promise<ImageBitmap> {
  let p = bitmapCache.get(src);
  if (!p) {
    p = fetch(src).then(async (res) => {
      if (!res.ok) throw new Error(`圖片下載失敗（${res.status}）`);
      return createImageBitmap(await res.blob());
    });
    bitmapCache.set(src, p);
    p.catch(() => bitmapCache.delete(src));
    if (bitmapCache.size > BITMAP_CACHE_LIMIT) {
      const oldest = bitmapCache.keys().next().value;
      if (oldest) bitmapCache.delete(oldest);
    }
  }
  return p;
}

export interface FieldCropZoomProps {
  src: string;
  /** 欄位範圍（0–1000 標準化座標）；LLM 給的是概略位置，繪製時會外擴 padding */
  box: InvoiceCropBox;
}

/** 欄位放大裁切圖：focus 表單欄位時浮出，眼睛不用移到照片區就能核對 */
export function FieldCropZoom({ src, box }: FieldCropZoomProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadBitmap(src)
      .then((bmp) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        // 0–1000 → 像素；外擴 padding（水平 18%、垂直 35%＋全圖 1%）容忍框偏移
        const bw = ((box.x1 - box.x0) / 1000) * bmp.width;
        const bh = ((box.y1 - box.y0) / 1000) * bmp.height;
        const padX = bw * 0.18 + bmp.width * 0.01;
        const padY = bh * 0.35 + bmp.height * 0.01;
        const sx = Math.max(0, (box.x0 / 1000) * bmp.width - padX);
        const sy = Math.max(0, (box.y0 / 1000) * bmp.height - padY);
        const sw = Math.min(bmp.width - sx, bw + padX * 2);
        const sh = Math.min(bmp.height - sy, bh + padY * 2);
        if (sw < 8 || sh < 8) return;
        // 目標寬 640（顯示約 320 寬的 2x 密度）；太高的框改以高度 360 為限
        let scale = 640 / sw;
        if (sh * scale > 360) scale = 360 / sh;
        canvas.width = Math.round(sw * scale);
        canvas.height = Math.round(sh * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      })
      .catch((err) => {
        console.error("欄位裁切圖繪製失敗:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [src, box.x0, box.y0, box.x1, box.y1]);

  return <canvas ref={canvasRef} className="h-auto w-full rounded bg-white" />;
}
