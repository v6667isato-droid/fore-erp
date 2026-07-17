"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { Crosshair } from "lucide-react";

export interface FocalPointPickerProps {
  /** 圖片 Public URL；null 時顯示提示文字 */
  imageUrl: string | null;
  /** CSS object-position 值（例如 "50% 30%"），空字串代表置中 */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** 官網裁切比例（CSS aspect-ratio 寫法），作品／訂製案例為 "4 / 5"、日誌列表為 "3 / 2" */
  previewAspect?: string;
  className?: string;
}

/** 把 "50% 30%" 解析成 { x, y }（%）；解析不了（如 "center"、空字串）回傳置中 */
function parsePosition(value: string): { x: number; y: number } {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!match) return { x: 50, y: 50 };
  return {
    x: Math.min(100, Math.max(0, Number(match[1]))),
    y: Math.min(100, Math.max(0, Number(match[2]))),
  };
}

/**
 * 圖片裁切焦點選點器：直接在原圖上點選要保留的重點位置，
 * 右側即時預覽官網裁切後的效果（object-cover + object-position）。
 */
export function FocalPointPicker({
  imageUrl,
  value,
  onChange,
  disabled = false,
  previewAspect = "4 / 5",
  className,
}: FocalPointPickerProps) {
  const { x, y } = parsePosition(value);
  const position = value.trim() || "center";

  const onPick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const px = Math.round(((e.clientX - rect.left) / rect.width) * 100);
      const py = Math.round(((e.clientY - rect.top) / rect.height) * 100);
      onChange(`${Math.min(100, Math.max(0, px))}% ${Math.min(100, Math.max(0, py))}%`);
    },
    [disabled, onChange]
  );

  if (!imageUrl) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        先上傳圖片，再點選裁切焦點。
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1" style={{ minWidth: "180px" }}>
          <span className="text-[11px] text-muted-foreground">
            點圖片設定焦點（裁切時會盡量保留此處）
          </span>
          <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            onClick={onPick}
            onKeyDown={(e) => {
              // 鍵盤微調：方向鍵每次移動 5%
              const step = 5;
              let nx = x;
              let ny = y;
              if (e.key === "ArrowLeft") nx -= step;
              else if (e.key === "ArrowRight") nx += step;
              else if (e.key === "ArrowUp") ny -= step;
              else if (e.key === "ArrowDown") ny += step;
              else return;
              e.preventDefault();
              if (disabled) return;
              onChange(
                `${Math.min(100, Math.max(0, nx))}% ${Math.min(100, Math.max(0, ny))}%`
              );
            }}
            className={cn(
              "relative w-full cursor-crosshair overflow-hidden rounded-lg border border-border bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              disabled && "pointer-events-none opacity-70"
            )}
            aria-label="點選圖片設定裁切焦點"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className="block h-auto w-full select-none" draggable={false} />
            <span
              className="pointer-events-none absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-black/40 shadow"
              style={{ left: `${x}%`, top: `${y}%` }}
              aria-hidden
            >
              <Crosshair className="h-3.5 w-3.5 text-white" />
            </span>
          </div>
        </div>
        <div className="flex w-[110px] shrink-0 flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">官網裁切預覽</span>
          <div
            className="relative w-full overflow-hidden rounded-lg border border-border bg-muted"
            style={{ aspectRatio: previewAspect }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: position }}
            />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          焦點：{value.trim() ? value.trim() : "置中（預設）"}
        </span>
        {value.trim() && (
          <button
            type="button"
            onClick={() => onChange("")}
            disabled={disabled}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:opacity-50"
          >
            重設置中
          </button>
        )}
      </div>
    </div>
  );
}
