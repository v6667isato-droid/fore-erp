"use client";

import { useCallback, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Upload, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

/** 預設 bucket（若你的是 product-image 單數，可改為 "product-image"）；可用 bucket prop 覆寫 */
const DEFAULT_BUCKET = "product-images";

const COMPRESSION_OPTIONS = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
};

export interface ProductImageDropzoneProps {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  className?: string;
  /** 上傳目標 Storage bucket，預設 product-images */
  bucket?: string;
  /** 無 value 時顯示的沿用中圖片（唯讀預覽：可點擊上傳取代，但不提供移除，也不會動到該檔案） */
  fallbackPreview?: string | null;
  /** 沿用預覽上的說明文字 */
  fallbackHint?: string;
}

/** 從 Supabase 公開 URL 解析 storage path（用於刪除） */
function getPathFromPublicUrl(publicUrl: string, bucket: string): string | null {
  try {
    const match = publicUrl.match(new RegExp(`/object/public/${bucket}/(.+)$`));
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function ProductImageDropzone({
  value,
  onChange,
  disabled = false,
  className,
  bucket = DEFAULT_BUCKET,
  fallbackPreview = null,
  fallbackHint,
}: ProductImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [storagePath, setStoragePath] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setUploading(true);
      try {
        const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
        const ext = compressed.name.split(".").pop()?.toLowerCase() || "webp";
        const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "webp";
        const filename = `${crypto.randomUUID()}.${safeExt}`;

        const { data, error } = await supabase.storage.from(bucket).upload(filename, compressed, {
          cacheControl: "3600",
          upsert: false,
        });

        if (error) throw error;

        const {
          data: { publicUrl },
        } = supabase.storage.from(bucket).getPublicUrl(data.path);
        setStoragePath(data.path);
        onChange(publicUrl);
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "圖片上傳失敗");
      } finally {
        setUploading(false);
      }
    },
    [onChange, bucket]
  );

  const handleRemove = useCallback(async () => {
    const path = storagePath || (value ? getPathFromPublicUrl(value, bucket) : null);
    if (path) {
      try {
        await supabase.storage.from(bucket).remove([path]);
      } catch (e) {
        console.error("Delete image from storage:", e);
      }
    }
    setStoragePath(null);
    onChange(null);
  }, [value, storagePath, onChange, bucket]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled || uploading) return;
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [disabled, uploading, handleFile]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

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
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => {
          if (!disabled && !uploading && !hasImage) inputRef.current?.click();
        }}
        className={cn(
          "relative min-h-[200px] w-full rounded-xl border-2 border-dashed transition-all duration-200",
          "border-[var(--border)] bg-[var(--muted)]/40",
          "hover:border-[var(--accent)] hover:bg-[var(--muted)]/60 hover:shadow-[0_0_0_1px_var(--accent)]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2",
          dragOver && "border-[var(--accent)] bg-[var(--secondary)] shadow-[0_0_0_1px_var(--accent)]",
          (disabled || uploading) && "pointer-events-none opacity-70",
          hasImage && "overflow-hidden border-solid p-0"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onInputChange}
          className="sr-only"
          aria-hidden
        />

        {uploading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-[var(--card)]/90 text-[var(--muted-foreground)]">
            <Loader2 className="h-10 w-10 animate-spin text-[var(--accent)]" aria-hidden />
            <span className="text-sm font-medium">上傳中…</span>
          </div>
        )}

        {hasImage && !uploading && (
          <>
            <img
              src={value}
              alt="產品主圖預覽"
              className="h-full min-h-[200px] w-full object-contain object-center"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleRemove();
              }}
              disabled={disabled}
              className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-lg bg-black/50 text-white transition-colors hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-50"
              aria-label="移除圖片"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}

        {!hasImage && !uploading && fallbackPreview && (
          <>
            <img
              src={fallbackPreview}
              alt="沿用中的圖片預覽"
              className="h-full min-h-[200px] w-full object-contain object-center"
            />
            <div className="absolute inset-x-0 bottom-0 z-10 bg-black/55 px-3 py-2 text-center">
              <p className="text-xs font-medium text-white">
                {fallbackHint || "目前沿用此圖；點擊或拖曳上傳專用圖以取代"}
              </p>
            </div>
          </>
        )}

        {!hasImage && !uploading && !fallbackPreview && (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <Upload className="h-10 w-10 text-[var(--muted-foreground)]" aria-hidden />
            <p className="text-sm font-medium text-[var(--muted-foreground)]">
              點擊或拖曳上傳高畫質產品主圖
            </p>
            <p className="text-xs text-[var(--muted-foreground)]/80">
              建議 1920px 內，將自動壓縮至 500KB 以內
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
