"use client";

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { SWATCH_BUCKET } from "@/lib/products-db";
import { cn } from "@/lib/utils";
import { Upload, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

/** 色樣輸出尺寸：1:1 方形，長邊 800px */
const SWATCH_SIZE = 800;

/** 從 Supabase 公開 URL 解析 storage path（用於刪除） */
function getPathFromPublicUrl(publicUrl: string, bucket: string): string | null {
  try {
    const match = publicUrl.match(new RegExp(`/object/public/${bucket}/(.+)$`));
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** 讀入圖片檔並置中裁切為 1:1 方形（800×800 webp） */
async function cropToSquare(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("圖片讀取失敗"));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const canvas = document.createElement("canvas");
    const out = Math.min(side, SWATCH_SIZE);
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("無法建立畫布");
    ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85)
    );
    if (!blob) throw new Error("圖片轉檔失敗");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface SwatchImageDropzoneProps {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  className?: string;
}

/** 色樣照片上傳：自動置中裁切為 1:1（800×800 webp）後上傳 material-swatches bucket */
export function SwatchImageDropzone({
  value,
  onChange,
  disabled = false,
  className,
}: SwatchImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setUploading(true);
      try {
        const blob = await cropToSquare(file);
        const filename = `${crypto.randomUUID()}.webp`;
        const { data, error } = await supabase.storage
          .from(SWATCH_BUCKET)
          .upload(filename, blob, { cacheControl: "3600", upsert: false, contentType: "image/webp" });
        if (error) throw error;
        const {
          data: { publicUrl },
        } = supabase.storage.from(SWATCH_BUCKET).getPublicUrl(data.path);
        onChange(publicUrl);
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "色樣上傳失敗");
      } finally {
        setUploading(false);
      }
    },
    [onChange]
  );

  const handleRemove = useCallback(async () => {
    const path = value ? getPathFromPublicUrl(value, SWATCH_BUCKET) : null;
    if (path) {
      try {
        await supabase.storage.from(SWATCH_BUCKET).remove([path]);
      } catch (e) {
        console.error("Delete swatch from storage:", e);
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
          if (!disabled && !uploading && !hasImage) inputRef.current?.click();
        }}
        className={cn(
          "relative aspect-square w-32 rounded-xl border-2 border-dashed transition-all duration-200",
          "border-border bg-muted/40 hover:border-ring",
          dragOver && "border-ring bg-secondary",
          (disabled || uploading) && "pointer-events-none opacity-70",
          hasImage && "overflow-hidden border-solid"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
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
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
          </div>
        )}

        {hasImage && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="色樣預覽" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleRemove();
              }}
              disabled={disabled}
              className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-white hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              aria-label="移除色樣照片"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {!hasImage && !uploading && (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
            <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-[11px] leading-tight text-muted-foreground">
              上傳照片
              <br />
              自動裁切 1:1
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
