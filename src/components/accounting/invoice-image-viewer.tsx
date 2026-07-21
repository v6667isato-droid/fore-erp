"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** AI 回傳的發票紙張範圍（0–1000 標準化座標，x0,y0 左上、x1,y1 右下） */
export interface InvoiceCropBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 檢查並整理 crop_box：夾回 0–1000；框反向或太小（多半是誤判）視為無效 */
export function sanitizeCropBox(raw: unknown): InvoiceCropBox | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nums = [r.x0, r.y0, r.x1, r.y1].map((v) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(1000, Math.max(0, v)) : null,
  );
  if (nums.some((v) => v == null)) return null;
  const [x0, y0, x1, y1] = nums as number[];
  if (x1 - x0 < 50 || y1 - y0 < 50) return null;
  return { x0, y0, x1, y1 };
}

/** 以容器中心為原點的縮放平移：畫面座標 = s × 圖面座標 + (tx, ty) */
interface ViewTransform {
  s: number;
  tx: number;
  ty: number;
}

const IDENTITY: ViewTransform = { s: 1, tx: 0, ty: 0 };
const MAX_SCALE = 8;

export interface InvoiceImageViewerProps {
  src: string;
  alt: string;
  /** 有值時預設聚焦放大該區域（可切回完整照片） */
  cropBox: InvoiceCropBox | null;
}

/** 發票照片檢視：AI 裁切自動聚焦＋滾輪縮放＋拖曳平移，雙擊回復 */
export function InvoiceImageViewer({ src, alt, cropBox }: InvoiceImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const naturalRef = useRef<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [cropMode, setCropMode] = useState(cropBox != null);
  const [view, setView] = useState<ViewTransform>(IDENTITY);

  /** 依 crop_box 算出聚焦用的縮放平移；外擴邊距避免剛好切到字 */
  const computeCropTransform = useCallback((): ViewTransform => {
    const el = containerRef.current;
    const nat = naturalRef.current;
    if (!el || !nat || !cropBox) return IDENTITY;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (!cw || !ch) return IDENTITY;
    // object-contain 後圖片實際顯示尺寸（置中）
    const fit = Math.min(cw / nat.w, ch / nat.h);
    const dw = nat.w * fit;
    const dh = nat.h * fit;
    const mx = (cropBox.x1 - cropBox.x0) * 0.03 + 10;
    const my = (cropBox.y1 - cropBox.y0) * 0.03 + 10;
    const x0 = Math.max(0, cropBox.x0 - mx);
    const x1 = Math.min(1000, cropBox.x1 + mx);
    const y0 = Math.max(0, cropBox.y0 - my);
    const y1 = Math.min(1000, cropBox.y1 + my);
    const boxW = ((x1 - x0) / 1000) * dw;
    const boxH = ((y1 - y0) / 1000) * dh;
    const s = Math.min(cw / boxW, ch / boxH, 6);
    if (s <= 1.05) return IDENTITY;
    const cx = (((x0 + x1) / 2) / 1000 - 0.5) * dw;
    const cy = (((y0 + y1) / 2) / 1000 - 0.5) * dh;
    return { s, tx: -s * cx, ty: -s * cy };
  }, [cropBox]);

  /** 平移限制：圖片中心最多拉到容器邊緣，避免整張飛出視野 */
  const clampView = useCallback((v: ViewTransform): ViewTransform => {
    const el = containerRef.current;
    const nat = naturalRef.current;
    if (!el || !nat) return v;
    const fit = Math.min(el.clientWidth / nat.w, el.clientHeight / nat.h);
    const maxX = (nat.w * fit * v.s) / 2;
    const maxY = (nat.h * fit * v.s) / 2;
    return {
      ...v,
      tx: Math.min(maxX, Math.max(-maxX, v.tx)),
      ty: Math.min(maxY, Math.max(-maxY, v.ty)),
    };
  }, []);

  // 換張圖時重置（onLoad 會再套用聚焦）
  const cropKey = cropBox ? `${cropBox.x0},${cropBox.y0},${cropBox.x1},${cropBox.y1}` : "";
  useEffect(() => {
    setCropMode(Boolean(cropKey));
    setView(IDENTITY);
  }, [src, cropKey]);

  // React 的 onWheel 是 passive，無法 preventDefault 擋掉頁面捲動，改手動掛非 passive 監聽
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      setView((v) => {
        const s = Math.min(MAX_SCALE, Math.max(1, v.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
        if (s === v.s) return v;
        if (s === 1) return IDENTITY;
        // 以游標位置為中心縮放：游標下的圖面點縮放前後不動
        const qx = (px - v.tx) / v.s;
        const qy = (py - v.ty) / v.s;
        return { s, tx: px - s * qx, ty: py - s * qy };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    naturalRef.current = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
    if (cropMode) setView(computeCropTransform());
  }

  function toggleCrop() {
    const next = !cropMode;
    setCropMode(next);
    setView(next ? computeCropTransform() : IDENTITY);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (view.s <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setView((v) => clampView({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  return (
    <div>
      <div
        ref={containerRef}
        className="relative h-[46vh] w-full touch-none select-none overflow-hidden rounded-md bg-muted/40 lg:h-[62vh]"
        style={{ cursor: view.s > 1 ? "grab" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setView(cropMode ? computeCropTransform() : IDENTITY)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Supabase 外部圖，僅審核時載入 */}
        <img
          src={src}
          alt={alt}
          onLoad={onImgLoad}
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
        {cropBox ? (
          <button
            type="button"
            onClick={toggleCrop}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/50"
          >
            {cropMode ? "顯示完整照片" : "聚焦發票區域"}
          </button>
        ) : (
          <span />
        )}
        <span className="text-[10px] text-muted-foreground">滾輪縮放｜拖曳平移｜雙擊回復</span>
      </div>
    </div>
  );
}
