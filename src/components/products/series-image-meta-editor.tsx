"use client";

import type { SeriesImageMeta } from "@/types/products";
import { FocalPointPicker } from "@/components/products/focal-point-picker";

export interface SeriesImageMetaEditorProps {
  /** 要設定的圖片（主視覺圖在前、細節圖依序），label 為顯示名稱 */
  images: { url: string; label: string }[];
  /** 以圖片 URL 為 key 的中繼資料 */
  meta: Record<string, SeriesImageMeta>;
  onChange: (meta: Record<string, SeriesImageMeta>) => void;
  disabled?: boolean;
}

/**
 * 逐張設定系列圖片的官網標題（中／英）與裁切焦點。
 * 標題留空則官網不顯示圖說；焦點留空為置中。
 */
export function SeriesImageMetaEditor({
  images,
  meta,
  onChange,
  disabled = false,
}: SeriesImageMetaEditorProps) {
  function setField(url: string, field: keyof SeriesImageMeta, value: string) {
    onChange({
      ...meta,
      [url]: { ...meta[url], [field]: value },
    });
  }

  if (images.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        先在上方上傳主視覺圖或細節圖，再逐張設定標題與裁切焦點。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {images.map(({ url, label }) => {
        const m = meta[url] ?? {};
        return (
          <div key={url} className="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/20 p-3">
            <span className="text-xs font-medium text-foreground">{label}</span>
            <FocalPointPicker
              imageUrl={url}
              value={m.object_position ?? ""}
              onChange={(v) => setField(url, "object_position", v)}
              disabled={disabled}
              previewAspect="2 / 3"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground" htmlFor={`img-meta-zh-${url}`}>
                  圖片標題（中）— 官網圖說，留空不顯示
                </label>
                <input
                  id={`img-meta-zh-${url}`}
                  type="text"
                  value={m.title_zh ?? ""}
                  onChange={(e) => setField(url, "title_zh", e.target.value)}
                  disabled={disabled}
                  className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="例：椅背細節"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground" htmlFor={`img-meta-en-${url}`}>
                  圖片標題（英）
                </label>
                <input
                  id={`img-meta-en-${url}`}
                  type="text"
                  value={m.title_en ?? ""}
                  onChange={(e) => setField(url, "title_en", e.target.value)}
                  disabled={disabled}
                  className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="例：Backrest detail"
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
