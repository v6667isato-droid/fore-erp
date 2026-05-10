"use client";

import { cn } from "@/lib/utils";
import { ImageIcon } from "lucide-react";

/** 產品系列主視覺（product_series.image_url）縮圖，用於訂單／入口選規格時對照 */
export function VariantSeriesThumb({
  imageUrl,
  className,
  sizeClassName = "h-[4.5rem] w-[4.5rem]",
  /** 小尺寸時僅顯示圖示，不顯示「無示意圖」文字 */
  compactPlaceholder = false,
}: {
  imageUrl?: string | null;
  className?: string;
  /** 預設約 72×72px */
  sizeClassName?: string;
  compactPlaceholder?: boolean;
}) {
  const url = imageUrl?.trim() ?? "";
  if (!url) {
    return (
      <div
        className={cn(
          "flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-input bg-muted/40 text-muted-foreground",
          compactPlaceholder && "gap-0",
          sizeClassName,
          className
        )}
        title="此系列尚無上傳示意圖"
      >
        <ImageIcon
          className={cn("opacity-60", compactPlaceholder ? "h-4 w-4" : "h-5 w-5")}
          aria-hidden
        />
        {!compactPlaceholder ? (
          <span className="px-1 text-center text-[9px] leading-tight">無示意圖</span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded-md border border-border bg-background shadow-sm",
        sizeClassName,
        className
      )}
    >
      <img
        src={url}
        alt="系列示意圖"
        className="h-full w-full object-contain"
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}
