 "use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { TABLE_PRODUCT_VARIANTS, TABLE_PRODUCT_SERIES, WOOD_TYPE_OPTIONS } from "@/lib/products-db";
import { Button } from "@/components/ui/button";
import { ProductImageDropzone } from "@/components/products/product-image-dropzone";
import { DimensionDrawingUpload } from "@/components/products/dimension-drawing-upload";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { VariantRow } from "@/types/products";
import { DEFAULT_SEAT_HEIGHT_CM } from "@/lib/product-seat-height";

export interface EditVariantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: VariantRow | null;
  onSuccess: () => void;
}

export function EditVariantDialog({ open, onOpenChange, row, onSuccess }: EditVariantDialogProps) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [woodType, setWoodType] = useState("");
  const [w, setW] = useState("");
  const [d, setD] = useState("");
  const [h, setH] = useState("");
  const [price, setPrice] = useState("");
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [channelPrices, setChannelPrices] = useState<Record<string, string>>({});
  const [seriesCodeRule, setSeriesCodeRule] = useState<string | null>(null);
  const [seriesCategory, setSeriesCategory] = useState<string | null>(null);
  const [spec1, setSpec1] = useState("");
  const [seatHeightCm, setSeatHeightCm] = useState("");
  const [armHeightCmInput, setArmHeightCmInput] = useState("");
  const [isCustomOrder, setIsCustomOrder] = useState(false);
  const [showOnSheet, setShowOnSheet] = useState(false);
  const [showOnPriceList, setShowOnPriceList] = useState(false);
  const [drawingUrl, setDrawingUrl] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && row) {
      setCode(row.product_code ?? "");
      setWoodType(row.wood_type ?? "");
      setW(row.dimension_w != null ? String(row.dimension_w) : "");
      setD(row.dimension_d != null ? String(row.dimension_d) : "");
      setH(row.dimension_h != null ? String(row.dimension_h) : "");
      setPrice(row.base_price != null ? String(row.base_price) : "");
      setError(null);
      setSeriesCodeRule(null);
      setSeriesCategory(null);
      setSpec1(row.spec1 ?? "");
      setSeatHeightCm(
        row.seat_height_cm != null ? String(row.seat_height_cm) : ""
      );
      // 扶手高度不補預設：留空即代表沒有這個規格
      setArmHeightCmInput(row.arm_height_cm != null ? String(row.arm_height_cm) : "");
      setIsCustomOrder(row.is_custom_order === true);
      setShowOnSheet(row.show_on_sheet === true);
      setShowOnPriceList(row.show_on_price_list === true);
      setDrawingUrl(
        typeof row.dimension_drawing_url === "string" && row.dimension_drawing_url
          ? row.dimension_drawing_url
          : null
      );
      setImageUrl(typeof row.image_url === "string" && row.image_url ? row.image_url : null);
    }
  }, [open, row]);

  useEffect(() => {
    if (!open || !row) return;
    (async () => {
      const [chRes, pricesRes, discountRes, seriesRes] = await Promise.all([
        supabase.from("channels").select("id, name").order("sort_order").order("name"),
        supabase.from("product_variant_channel_prices").select("channel_id, price").eq("variant_id", row.id),
        supabase
          .from("product_series_channel_discounts")
          .select("channel_id, discount_percent")
          .eq("series_id", row.series_id),
        supabase
          .from(TABLE_PRODUCT_SERIES)
          .select("code_rule, category")
          .eq("id", row.series_id)
          .maybeSingle(),
      ]);
      const chList = ((chRes.data ?? []) as { id: string; name: string }[]).map((c) => ({
        id: c.id,
        name: String(c.name ?? ""),
      }));
      setChannels(chList);
      const overrideMap: Record<string, string> = {};
      ((pricesRes.data ?? []) as { channel_id: string; price: number }[]).forEach((p) => {
        overrideMap[p.channel_id] = p.price != null ? String(p.price) : "";
      });
      const discountMap: Record<string, number> = {};
      ((discountRes.data ?? []) as { channel_id: string; discount_percent: number }[]).forEach((d) => {
        discountMap[d.channel_id] = Number(d.discount_percent ?? 0);
      });
      const prices: Record<string, string> = {};
      chList.forEach((c) => {
        const overrideVal = overrideMap[c.id];
        if (overrideVal != null) {
          prices[c.id] = overrideVal;
        } else if (row.base_price != null && discountMap[c.id] != null) {
          const base = Number(row.base_price);
          const pct = discountMap[c.id];
          const computed = Math.round(base * (1 - pct / 100));
          prices[c.id] = String(computed);
        } else {
          prices[c.id] = "";
        }
      });
      setChannelPrices(prices);
      if (!seriesRes.error && seriesRes.data) {
        const data = seriesRes.data as any;
        if (typeof data.code_rule === "string") {
          const val = data.code_rule.trim();
          setSeriesCodeRule(val || null);
        } else {
          setSeriesCodeRule(null);
        }
        if (typeof data.category === "string") {
          setSeriesCategory(data.category);
          if (
            (data.category === "椅" || data.category === "凳") &&
            row.seat_height_cm == null
          ) {
            setSeatHeightCm(String(DEFAULT_SEAT_HEIGHT_CM));
          }
        } else {
          setSeriesCategory(null);
        }
      } else {
        setSeriesCodeRule(null);
        setSeriesCategory(null);
      }
    })();
  }, [open, row]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    setError(null);
    if (!code.trim()) {
      setError("請輸入產品代碼");
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      product_code: code.trim(),
      wood_type: woodType.trim() || null,
      dimension_w: w.trim() ? Number(w) : null,
      dimension_d: d.trim() ? Number(d) : null,
      dimension_h: h.trim() ? Number(h) : null,
      base_price: price.trim() ? Number(price) : null,
      spec1: spec1.trim() || null,
      image_url: imageUrl?.trim() || null,
      is_custom_order: isCustomOrder,
      show_on_sheet: showOnSheet,
      show_on_price_list: showOnPriceList,
      dimension_drawing_url: drawingUrl?.trim() || null,
    };
    if (seriesCategory === "椅" || seriesCategory === "凳") {
      payload.seat_height_cm = seatHeightCm.trim() ? Number(seatHeightCm) : null;
      payload.arm_height_cm = armHeightCmInput.trim() ? Number(armHeightCmInput) : null;
    }
    const { error: err } = await supabase.from(TABLE_PRODUCT_VARIANTS).update(payload).eq("id", row.id);
    if (err) {
      setSaving(false);
      toast.error(err.message || "更新規格失敗");
      setError(err.message || "更新規格失敗");
      return;
    }
    // 通路價一律現算（定價 × 系列折扣率），不再寫入 product_variant_channel_prices（凍結為歷史表）
    setSaving(false);
    toast.success("已更新規格");
    onOpenChange(false);
    onSuccess();
  }

  if (!row) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="edit-variant-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">編輯規格</Dialog.Title>
              <p id="edit-variant-desc" className="mt-1 text-sm text-muted-foreground">修改產品代碼、尺寸與定價</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">規格圖片</span>
              <ProductImageDropzone value={imageUrl} onChange={setImageUrl} disabled={saving} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-variant-code" className="text-xs text-muted-foreground">產品代碼 *</label>
              <input ref={firstRef} id="edit-variant-code" type="text" value={code} onChange={(e) => setCode(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
              {seriesCodeRule && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  編碼原則：{seriesCodeRule}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-variant-wood" className="text-xs text-muted-foreground">木種</label>
              <input
                id="edit-variant-wood"
                type="text"
                list="edit-variant-wood-list"
                value={woodType}
                onChange={(e) => setWoodType(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="例：白橡木"
              />
              <datalist id="edit-variant-wood-list">
                {WOOD_TYPE_OPTIONS.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-variant-w" className="text-xs text-muted-foreground">寬 W（cm）</label>
                <input id="edit-variant-w" type="number" value={w} onChange={(e) => setW(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="cm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-variant-d" className="text-xs text-muted-foreground">深 D（cm）</label>
                <input id="edit-variant-d" type="number" value={d} onChange={(e) => setD(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="cm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-variant-h" className="text-xs text-muted-foreground">高 H（cm）</label>
                <input id="edit-variant-h" type="number" value={h} onChange={(e) => setH(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="cm" />
              </div>
            </div>
            {(seriesCategory === "椅" || seriesCategory === "凳") && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-variant-seat-h" className="text-xs text-muted-foreground">座高（cm）</label>
                <input
                  id="edit-variant-seat-h"
                  type="number"
                  value={seatHeightCm}
                  onChange={(e) => setSeatHeightCm(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={`預設 ${DEFAULT_SEAT_HEIGHT_CM}cm，座面離地高度`}
                />
              </div>
            )}
            {(seriesCategory === "椅" || seriesCategory === "凳") && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-variant-arm-h" className="text-xs text-muted-foreground">扶手高度 AH（cm）</label>
                <input
                  id="edit-variant-arm-h"
                  type="number"
                  value={armHeightCmInput}
                  onChange={(e) => setArmHeightCmInput(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="無扶手請留空，留空則各處不顯示"
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-variant-price" className="text-xs text-muted-foreground">基礎定價</label>
              <input id="edit-variant-price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-variant-spec1" className="text-xs text-muted-foreground">規格 1</label>
              {seriesCategory === "椅" ? (
                <select
                  id="edit-variant-spec1"
                  value={spec1}
                  onChange={(e) => setSpec1(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">—</option>
                  <option value="紙繩-P">紙繩-P</option>
                  <option value="藤編-R">藤編-R</option>
                  <option value="實木-W">實木-W</option>
                  <option value="布墊-F">布墊-F</option>
                </select>
              ) : (
                <input
                  id="edit-variant-spec1"
                  type="text"
                  value={spec1}
                  onChange={(e) => setSpec1(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="可自訂此類別的第一個規格"
                />
              )}
            </div>
            <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnSheet}
                onChange={(e) => setShowOnSheet(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-foreground">顯示於產品介紹表</span>
                <span className="text-[11px] text-muted-foreground">勾選後此規格會出現在介紹表第二頁（與價目表勾選各自獨立）</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnPriceList}
                onChange={(e) => setShowOnPriceList(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-foreground">顯示於價目表</span>
                <span className="text-[11px] text-muted-foreground">勾選後此規格會出現在對外價目表</span>
              </span>
            </label>
            {showOnSheet && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">尺寸線圖（SVG / PNG，Fusion 360 匯出）</span>
                <DimensionDrawingUpload value={drawingUrl} onChange={setDrawingUrl} disabled={saving} />
                {!drawingUrl && (
                  <p className="text-[11px] text-accent-warn">
                    缺線圖：介紹表上此規格的線圖位置會留白
                  </p>
                )}
              </div>
            )}
            <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isCustomOrder}
                onChange={(e) => setIsCustomOrder(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-foreground">訂製款（開單佔位用）</span>
                <span className="text-[11px] text-muted-foreground">不列入產品介紹表／價目表；新增訂單選到時牌價改為手動輸入</span>
              </span>
            </label>
            {channels.length > 0 && (() => {
              const visibleChannels = channels.filter((ch) => {
                const raw = (channelPrices[ch.id] ?? "").trim();
                return raw !== "" && !Number.isNaN(Number(raw));
              });
              if (!visibleChannels.length) return null;
              return (
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    通路售價（依系列折扣或通路價自動計算，僅顯示已設定者）
                  </p>
                  {visibleChannels.map((ch) => {
                    const raw = (channelPrices[ch.id] ?? "").trim();
                    const num = Number(raw);
                    return (
                      <div key={ch.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-xs text-muted-foreground w-24 shrink-0">
                          {ch.name}
                        </span>
                        <span className="flex-1 text-right font-medium">
                          {Number.isFinite(num) ? num.toLocaleString() : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild><Button type="button" variant="ghost" disabled={saving}>取消</Button></Dialog.Close>
              <Button type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
