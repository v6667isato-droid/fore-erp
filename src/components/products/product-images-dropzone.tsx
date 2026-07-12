"use client";

import { useCallback, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Upload, Loader2, Trash2, ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";

/** 與 Supabase Storage bucket 名稱一致（與主視覺圖共用） */
const BUCKET = "product-images";

const COMPRESSION_OPTIONS = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
};

const BUCKET_REGEX = new RegExp(`/object/public/${BUCKET}/(.+)$`);

/** 從 Supabase 公開 URL 解析 storage path（用於刪除） */
function getPathFromPublicUrl(publicUrl: string): string | null {
  try {
    const match = publicUrl.match(BUCKET_REGEX);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export interface ProductImagesDropzoneProps {
  /** 目前已上傳的圖片 Public URL 陣列 */
  value: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * 多圖上傳（張數不限）：用於產品系列尺寸圖。
 * 支援一次選取多張、拖曳上傳、逐張移除，以及左右調整順序。
 */
export function ProductImagesDropzone({
  value,
  onChange,
  disabled = false,
  className,
}: ProductImagesDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const uploading = uploadingCount > 0;

  const uploadOne = useCallback(async (file: File): Promise<string | null> => {
    if (!file.type.startsWith("image/")) return null;
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
    const ext = compressed.name.split(".").pop()?.toLowerCase() || "webp";
    const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "webp";
    const filename = `${crypto.randomUUID()}.${safeExt}`;
    const { data, error } = await supabase.storage.from(BUCKET).upload(filename, compressed, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;
    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
    return publicUrl;
  }, []);

  const handleFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) return;
      setUploadingCount((c) => c + images.length);
      const uploaded: string[] = [];
      for (const file of images) {
        try {
          const url = await uploadOne(file);
          if (url) uploaded.push(url);
        } catch (err) {
          console.error(err);
          toast.error(err instanceof Error ? err.message : "圖片上傳失敗");
        } finally {
          setUploadingCount((c) => c - 1);
        }
      }
      if (uploaded.length) onChange([...value, ...uploaded]);
    },
    [uploadOne, onChange, value]
  );

  const handleRemove = useCallback(
    async (url: string) => {
      const path = getPathFromPublicUrl(url);
      if (path) {
        try {
          await supabase.storage.from(BUCKET).remove([path]);
        } catch (e) {
          console.error("Delete image from storage:", e);
        }
      }
      onChange(value.filter((u) => u !== url));
    },
    [value, onChange]
  );

  const move = useCallback(
    (index: number, dir: -1 | 1) => {
      const target = index + dir;
      if (target < 0 || target >= value.length) return;
      const next = [...value];
      [next[index], next[target]] = [next[target], next[index]];
      onChange(next);
    },
    [value, onChange]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length) void handleFiles(files);
    },
    [disabled, handleFiles]
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length) void handleFiles(files);
      e.target.value = "";
    },
    [handleFiles]
  );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {value.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {value.map((url, index) => (
            <div
              key={url}
              className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`尺寸圖 ${index + 1}`} className="h-full w-full object-contain" />
              <span className="absolute left-1 top-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {index + 1}
              </span>
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/60 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={disabled || index === 0}
                    className="flex h-6 w-6 items-center justify-center rounded bg-black/50 text-white hover:bg-black/70 disabled:opacity-30"
                    aria-label={`將第 ${index + 1} 張往前`}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={disabled || index === value.length - 1}
                    className="flex h-6 w-6 items-center justify-center rounded bg-black/50 text-white hover:bg-black/70 disabled:opacity-30"
                    aria-label={`將第 ${index + 1} 張往後`}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemove(url)}
                  disabled={disabled}
                  className="flex h-6 w-6 items-center justify-center rounded bg-black/50 text-white hover:bg-red-600/80 disabled:opacity-50"
                  aria-label={`移除第 ${index + 1} 張尺寸圖`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!disabled) inputRef.current?.click();
          }
        }}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        className={cn(
          "relative flex min-h-[92px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-4 text-center transition-all duration-200",
          "border-[var(--border)] bg-[var(--muted)]/40",
          "hover:border-[var(--accent)] hover:bg-[var(--muted)]/60",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2",
          dragOver && "border-[var(--accent)] bg-[var(--secondary)]",
          disabled && "pointer-events-none opacity-70"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={onInputChange}
          className="sr-only"
          aria-hidden
        />
        {uploading ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" aria-hidden />
            <span className="text-xs font-medium text-[var(--muted-foreground)]">
              上傳中…（{uploadingCount}）
            </span>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-[var(--muted-foreground)]" aria-hidden />
            <p className="text-xs font-medium text-[var(--muted-foreground)]">
              點擊或拖曳上傳尺寸圖（可一次多張，張數不限）
            </p>
          </>
        )}
      </div>
    </div>
  );
}
