"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

export interface LightboxImage {
  url: string;
  title?: string | null;
}

export interface ImageLightboxProps {
  images: LightboxImage[];
  /** 目前顯示第幾張；null＝關閉 */
  index: number | null;
  onIndexChange: (index: number | null) => void;
}

const iconBtn =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-40";

/** 全螢幕看圖：可左右切換多張，滾輪／雙指縮放、拖曳平移、雙擊放大或還原 */
export function ImageLightbox({ images, index, onIndexChange }: ImageLightboxProps) {
  const current = index != null ? images[index] : undefined;
  const total = images.length;
  const hasMany = total > 1;

  const go = useCallback(
    (delta: -1 | 1) => {
      if (index == null || total < 2) return;
      onIndexChange((index + delta + total) % total);
    },
    [index, total, onIndexChange],
  );

  const title = current?.title?.trim() || "圖片";

  return (
    <Dialog.Root
      open={current != null}
      onOpenChange={(open) => {
        if (!open) onIndexChange(null);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/90" />
        {current && index != null ? (
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-white focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                go(-1);
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                go(1);
              }
            }}
          >
            <div className="flex shrink-0 items-center gap-2 px-3 py-2 sm:px-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="truncate text-sm font-medium">{title}</Dialog.Title>
                {hasMany ? (
                  <p className="text-xs tabular-nums text-white/60">
                    {index + 1} / {total}
                  </p>
                ) : null}
              </div>
              <a
                href={current.url}
                target="_blank"
                rel="noopener noreferrer"
                className={iconBtn}
                title="在新分頁開啟原圖"
                aria-label="在新分頁開啟原圖"
              >
                <ExternalLink className="h-5 w-5" />
              </a>
              <Dialog.Close asChild>
                <button type="button" className={iconBtn} title="關閉" aria-label="關閉">
                  <X className="h-6 w-6" />
                </button>
              </Dialog.Close>
            </div>
            <div className="relative min-h-0 flex-1">
              <ZoomableImage
                key={`${index}:${current.url}`}
                src={current.url}
                alt={title}
                onSwipe={hasMany ? go : undefined}
              />
              {hasMany ? (
                <>
                  <button
                    type="button"
                    className={`${iconBtn} absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 sm:left-4`}
                    title="上一張"
                    aria-label="上一張"
                    onClick={() => go(-1)}
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    className={`${iconBtn} absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 sm:right-4`}
                    title="下一張"
                    aria-label="下一張"
                    onClick={() => go(1)}
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                </>
              ) : null}
            </div>
          </Dialog.Content>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 以容器中心為原點的縮放平移：畫面座標 = s × 圖面座標 + (tx, ty) */
interface ViewTransform {
  s: number;
  tx: number;
  ty: number;
}

type Gesture =
  | { kind: "pan"; startX: number; startY: number; lastX: number; lastY: number; moved: boolean }
  | { kind: "pinch"; startDist: number; startScale: number; qx: number; qy: number };

const IDENTITY: ViewTransform = { s: 1, tx: 0, ty: 0 };
const MAX_SCALE = 8;
const BUTTON_STEP = 1.5;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 10;
const SWIPE_MIN_PX = 60;

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(1, s));
}

function ZoomableImage({
  src,
  alt,
  onSwipe,
}: {
  src: string;
  alt: string;
  /** 未放大時左右滑動切換上一張／下一張 */
  onSwipe?: (delta: -1 | 1) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const naturalRef = useRef<{ w: number; h: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<Gesture | null>(null);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const [view, setView] = useState<ViewTransform>(IDENTITY);
  // 按鈕／雙擊縮放時加過渡動畫；拖曳、雙指、滾輪要即時跟手，不加
  const [smooth, setSmooth] = useState(false);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  /** 平移限制：放大後圖片邊緣不離開畫面邊緣；圖比畫面小的方向維持置中 */
  const clampView = useCallback((v: ViewTransform): ViewTransform => {
    const s = clampScale(v.s);
    if (s === 1) return IDENTITY;
    const el = stageRef.current;
    const nat = naturalRef.current;
    if (!el || !nat) return { ...v, s };
    // clientWidth/Height 會四捨五入成整數，放大後邊緣差到 1px 以上，改用精確尺寸
    const { width: cw, height: ch } = el.getBoundingClientRect();
    // object-contain 後圖片實際顯示尺寸
    const fit = Math.min(cw / nat.w, ch / nat.h);
    const maxX = Math.max(0, (nat.w * fit * s - cw) / 2);
    const maxY = Math.max(0, (nat.h * fit * s - ch) / 2);
    return {
      s,
      tx: Math.min(maxX, Math.max(-maxX, v.tx)),
      ty: Math.min(maxY, Math.max(-maxY, v.ty)),
    };
  }, []);

  /** 以畫面上 (px, py) 為中心縮放到 nextScale：該點下的圖面位置縮放前後不動 */
  const zoomAround = useCallback(
    (v: ViewTransform, nextScale: number, px: number, py: number): ViewTransform => {
      const s = clampScale(nextScale);
      if (s === v.s) return v;
      const qx = (px - v.tx) / v.s;
      const qy = (py - v.ty) / v.s;
      return clampView({ s, tx: px - s * qx, ty: py - s * qy });
    },
    [clampView],
  );

  function toStagePoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }

  // React 的 onWheel 是 passive，無法 preventDefault 擋掉頁面捲動，改手動掛非 passive 監聽
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      // 觸控板雙指縮放會帶 ctrlKey 且 delta 較小，放大靈敏度
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002));
      setSmooth(false);
      setView((v) => zoomAround(v, v.s * factor, px, py));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAround]);

  /** 依目前按住的手指數決定手勢：一指拖曳／滑動，兩指縮放 */
  function beginGesture() {
    const pts = [...pointersRef.current.values()];
    if (pts.length === 1) {
      const [p] = pts;
      gestureRef.current = {
        kind: "pan",
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        lastY: p.y,
        moved: false,
      };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      const mid = toStagePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      gestureRef.current = {
        kind: "pinch",
        startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        startScale: view.s,
        qx: (mid.x - view.tx) / view.s,
        qy: (mid.y - view.ty) / view.s,
      };
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setSmooth(false);
    beginGesture();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const pointers = pointersRef.current;
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === "pinch") {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const mid = toStagePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const s = clampScale((g.startScale * Math.hypot(a.x - b.x, a.y - b.y)) / g.startDist);
      // 兩指中點下的圖面位置固定跟著手指走，縮放同時可平移
      setView(clampView({ s, tx: mid.x - s * g.qx, ty: mid.y - s * g.qy }));
      return;
    }
    const dx = e.clientX - g.lastX;
    const dy = e.clientY - g.lastY;
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > TAP_SLOP_PX) g.moved = true;
    if (view.s > 1) {
      setView((v) => clampView({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const pointers = pointersRef.current;
    if (!pointers.delete(e.pointerId)) return;
    const g = gestureRef.current;
    if (pointers.size > 0) {
      // 雙指放開一指：剩下那指接著拖曳，但不算點擊
      beginGesture();
      if (gestureRef.current?.kind === "pan") gestureRef.current.moved = true;
      return;
    }
    gestureRef.current = null;
    if (!g || g.kind !== "pan" || e.type === "pointercancel") return;

    if (!g.moved) {
      // 雙擊（滑鼠）／雙點（觸控）：未放大 → 以點擊處放大；已放大 → 還原
      const now = Date.now();
      const last = lastTapRef.current;
      if (
        last &&
        now - last.t < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - last.x, e.clientY - last.y) < TAP_SLOP_PX * 3
      ) {
        lastTapRef.current = null;
        const p = toStagePoint(e.clientX, e.clientY);
        setSmooth(true);
        setView((v) => (v.s > 1 ? IDENTITY : zoomAround(v, DOUBLE_TAP_SCALE, p.x, p.y)));
      } else {
        lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
      }
      return;
    }

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (onSwipe && view.s === 1 && Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      onSwipe(dx < 0 ? 1 : -1);
    }
  }

  function zoomBy(factor: number) {
    setSmooth(true);
    setView((v) => zoomAround(v, v.s * factor, 0, 0));
  }

  function resetView() {
    setSmooth(true);
    setView(IDENTITY);
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
        style={{ cursor: view.s > 1 ? "grab" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className={`absolute inset-0 ${smooth ? "transition-transform duration-200 ease-out" : ""}`}
          style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase 外部圖，放大檢視時才載入 */}
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(e) => {
              naturalRef.current = {
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              };
              setStatus("loaded");
            }}
            onError={() => setStatus("error")}
            className="pointer-events-none h-full w-full object-contain"
          />
        </div>
        {status === "loading" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/70" />
          </div>
        ) : status === "error" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-white/70">
            圖片載入失敗
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className={iconBtn}
            title="縮小"
            aria-label="縮小"
            disabled={view.s <= 1}
            onClick={() => zoomBy(1 / BUTTON_STEP)}
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-white/80">
            {Math.round(view.s * 100)}%
          </span>
          <button
            type="button"
            className={iconBtn}
            title="放大"
            aria-label="放大"
            disabled={view.s >= MAX_SCALE}
            onClick={() => zoomBy(BUTTON_STEP)}
          >
            <ZoomIn className="h-5 w-5" />
          </button>
          <button
            type="button"
            className={iconBtn}
            title="還原大小"
            aria-label="還原大小"
            disabled={view.s <= 1}
            onClick={resetView}
          >
            <RotateCcw className="h-5 w-5" />
          </button>
        </div>
        <p className="text-center text-[11px] text-white/50">
          滾輪或雙指縮放・雙擊放大／還原・放大後可拖曳移動
        </p>
      </div>
    </div>
  );
}
