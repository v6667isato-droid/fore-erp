"use client";

import { useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Image as ImageIcon, Loader2, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import type { ExplanationImage } from "@/lib/explanation-images";
import { uploadExplanationImage } from "@/lib/explanation-image-upload";
import { cn } from "@/lib/utils";

/**
 * 訂單說明圖編輯區（多張、可排序、可下標題、點擊放大）。
 * ERP 訂單「訂單說明圖」與通路下單「製作圖」共用，皆寫入 orders.explanation_image_url。
 */
export function ExplanationImagesEditor({
  images,
  onChange,
  readOnly = false,
  label,
  itemLabel = "訂單說明圖",
  className,
  labelClassName = "text-xs text-muted-foreground",
}: {
  images: ExplanationImage[];
  onChange: (next: ExplanationImage[]) => void;
  readOnly?: boolean;
  label: string;
  /** 單張圖片的稱呼：用於預設標題、按鈕與提示文字 */
  itemLabel?: string;
  className?: string;
  labelClassName?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const idPrefix = useId();

  // 上傳期間使用者可能又改了標題／順序，一律以最新清單為準再附加
  const imagesRef = useRef(images);
  imagesRef.current = images;

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const url = await uploadExplanationImage(file);
      onChange([...imagesRef.current, { url, title: null }]);
      toast.success(`${itemLabel}已上傳`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : `${itemLabel}上傳失敗`);
    } finally {
      setUploading(false);
    }
  }

  function removeAt(index: number) {
    onChange(images.filter((_, i) => i !== index));
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function updateTitle(index: number, title: string) {
    onChange(images.map((it, i) => (i === index ? { ...it, title: title.trim() || null } : it)));
  }

  const lightboxImages = images.map((img, i) => ({
    url: img.url,
    title: img.title?.trim() || `${itemLabel} ${i + 1}`,
  }));

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border border-dashed border-border bg-background p-4",
        className,
      )}
    >
      <span className={cn(labelClassName, "font-medium")}>{label}</span>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
        {images.length > 0 ? (
          images.map((img, idx) => (
            <div key={`${img.url}-${idx}`} className="flex min-w-0 items-start gap-2">
              <button
                type="button"
                onClick={() => setLightboxIndex(idx)}
                className="relative h-28 w-28 shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-32 sm:w-32"
                title="點擊放大"
                aria-label={`放大檢視${itemLabel} ${idx + 1}`}
              >
                <img
                  src={img.url}
                  alt={`${itemLabel} ${idx + 1}`}
                  className="h-full w-full object-cover"
                />
                <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/60 p-1 text-white">
                  <ZoomIn className="h-3.5 w-3.5" />
                </span>
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-none">
                {!readOnly ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 w-8 p-0"
                      title="往前移"
                      aria-label="往前移"
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0 || uploading}
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 w-8 p-0"
                      title="往後移"
                      aria-label="往後移"
                      onClick={() => move(idx, 1)}
                      disabled={idx === images.length - 1 || uploading}
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={() => removeAt(idx)}
                      disabled={uploading}
                    >
                      移除
                    </Button>
                  </div>
                ) : null}
                <div className="flex min-w-0 flex-col gap-1">
                  <label className="text-[11px] text-muted-foreground" htmlFor={`${idPrefix}-title-${idx}`}>
                    圖片標題（選填）
                  </label>
                  <input
                    id={`${idPrefix}-title-${idx}`}
                    type="text"
                    value={img.title ?? ""}
                    onChange={(e) => updateTitle(idx, e.target.value)}
                    readOnly={readOnly}
                    placeholder={`${itemLabel} ${idx + 1}`}
                    className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:cursor-default read-only:bg-muted/30 sm:w-56"
                  />
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">尚未上傳{itemLabel}。</p>
        )}
        {!readOnly ? (
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2 text-xs"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  上傳中…
                </>
              ) : (
                <>
                  <ImageIcon className="mr-1 h-3 w-3" />
                  上傳{itemLabel}
                </>
              )}
            </Button>
          </div>
        ) : null}
      </div>
      <ImageLightbox images={lightboxImages} index={lightboxIndex} onIndexChange={setLightboxIndex} />
    </div>
  );
}
