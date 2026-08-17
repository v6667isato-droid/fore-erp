"use client";

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DIMENSION_DRAWING_BUCKET } from "@/lib/products-db";
import { cn } from "@/lib/utils";
import { Upload, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

/** 從 Supabase 公開 URL 解析 storage path（用於刪除） */
function getPathFromPublicUrl(publicUrl: string, bucket: string): string | null {
  try {
    const match = publicUrl.match(new RegExp(`/object/public/${bucket}/(.+)$`));
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * PNG 自動裁切留白：LayOut／Fusion 匯出的是整張大畫布，線圖常只佔一角。
 * 掃描非白（且非透明）像素的外框，加固定邊距後裁下；掃不到內容時原樣回傳。
 * 回傳裁切後的像素尺寸，供檔名編碼（列印頁據此以 300DPI 固定比例渲染）。
 */
async function trimPngWhitespace(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("圖片讀取失敗"));
      el.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: file, w, h };
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);

    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const ink = data[i + 3] > 16 && !(data[i] > 247 && data[i + 1] > 247 && data[i + 2] > 247);
        if (ink) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    // 全白／全透明 → 不裁
    if (maxX < 0) return { blob: file, w, h };
    // 固定邊距（300DPI 下約 1mm），不隨圖大小變動，維持各產品一致的留白
    const pad = 12;
    const cx = Math.max(0, minX - pad);
    const cy = Math.max(0, minY - pad);
    const cw = Math.min(w, maxX + pad + 1) - cx;
    const ch = Math.min(h, maxY + pad + 1) - cy;
    if (cw >= w * 0.97 && ch >= h * 0.97) return { blob: file, w, h };

    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    const outCtx = out.getContext("2d");
    if (!outCtx) return { blob: file, w, h };
    outCtx.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
    return blob ? { blob, w: cw, h: ch } : { blob: file, w, h };
  } catch {
    return { blob: file, w: 0, h: 0 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 從檔名 _WxH 估算介紹表縮放比例（%）：印出寬（px × 25.4/300）超過格寬時會被縮小。
 * 以無價目 4 欄格寬 54.8mm 為基準（有價目 3 欄 51.6mm 會再小一點）；
 * 回傳 100＝不縮放；null＝無法判斷（SVG 或舊檔名無尺寸）。
 * 注意：介紹表實際是整頁統一縮放，若同系列有更大的圖，實際比例會更低。
 */
export function drawingScalePercent(url: string | null | undefined, capMm = 54.8): number | null {
  if (!url) return null;
  const m = url.match(/_(\d+)x(\d+)\.png(?:\?|$)/);
  if (!m) return null;
  const wMm = Number(m[1]) * (25.4 / 300);
  if (!(wMm > 0)) return null;
  return wMm <= capMm ? 100 : Math.round((capMm / wMm) * 100);
}

export interface DimensionDrawingUploadProps {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  className?: string;
}

/** 尺寸線圖上傳（SVG／PNG 原檔直傳 dimension-drawings bucket，不壓縮；Fusion 360 匯出後人工上傳） */
export function DimensionDrawingUpload({
  value,
  onChange,
  disabled = false,
  className,
}: DimensionDrawingUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
      const isPng = file.type === "image/png" || /\.png$/i.test(file.name);
      if (!isSvg && !isPng) {
        toast.error("尺寸線圖僅接受 SVG 或 PNG");
        return;
      }
      setUploading(true);
      try {
        // PNG 自動裁掉四周留白（LayOut 匯出常是整張畫布）；SVG 原樣直傳。
        // 裁切後像素尺寸編進檔名（uuid_WxH.png），列印頁據此以 300DPI 固定比例渲染
        let filename: string;
        let payload: Blob;
        if (isSvg) {
          filename = `${crypto.randomUUID()}.svg`;
          payload = file;
        } else {
          const trimmed = await trimPngWhitespace(file);
          payload = trimmed.blob;
          filename =
            trimmed.w > 0 && trimmed.h > 0
              ? `${crypto.randomUUID()}_${trimmed.w}x${trimmed.h}.png`
              : `${crypto.randomUUID()}.png`;
        }
        const { data, error } = await supabase.storage
          .from(DIMENSION_DRAWING_BUCKET)
          .upload(filename, payload, {
            cacheControl: "3600",
            upsert: false,
            contentType: isSvg ? "image/svg+xml" : "image/png",
          });
        if (error) throw error;
        const {
          data: { publicUrl },
        } = supabase.storage.from(DIMENSION_DRAWING_BUCKET).getPublicUrl(data.path);
        onChange(publicUrl);
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "尺寸線圖上傳失敗");
      } finally {
        setUploading(false);
      }
    },
    [onChange]
  );

  const handleRemove = useCallback(async () => {
    const path = value ? getPathFromPublicUrl(value, DIMENSION_DRAWING_BUCKET) : null;
    if (path) {
      try {
        await supabase.storage.from(DIMENSION_DRAWING_BUCKET).remove([path]);
      } catch (e) {
        console.error("Delete drawing from storage:", e);
      }
    }
    onChange(null);
  }, [value, onChange]);

  const hasImage = !!value && !uploading;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!disabled && !uploading) inputRef.current?.click();
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (disabled || uploading) return;
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onClick={() => {
          if (!disabled && !uploading) inputRef.current?.click();
        }}
        className={cn(
          "relative flex min-h-[88px] w-full items-center justify-center rounded-xl border-2 border-dashed transition-all duration-200",
          "border-border bg-muted/40 hover:border-ring",
          dragOver && "border-ring bg-secondary",
          (disabled || uploading) && "pointer-events-none opacity-70",
          hasImage && "border-solid bg-white"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/svg+xml,image/png,.svg,.png"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
          className="sr-only"
          aria-hidden
        />

        {uploading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-card/90">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        )}

        {hasImage && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt="尺寸線圖預覽"
              className="max-h-[120px] w-auto max-w-full object-contain px-2 py-1.5"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleRemove();
              }}
              disabled={disabled}
              className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-white hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              aria-label="移除尺寸線圖"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {!hasImage && !uploading && (
          <div className="flex flex-col items-center justify-center gap-1 px-3 py-4 text-center">
            <Upload className="h-4 w-4 text-muted-foreground" aria-hidden />
            <p className="text-[11px] text-muted-foreground">上傳尺寸線圖（SVG / PNG）</p>
            <p className="text-[10px] text-muted-foreground/80">
              LayOut 匯出 PNG 設 100 DPI（調高 DPI 可放大，寬度上限一格）
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
