"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { TABLE_PRODUCT_VARIANTS, TABLE_PRODUCT_SERIES } from "@/lib/products-db";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { VariantRow } from "@/types/products";

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
    };
    payload.spec1 = spec1.trim() || null;
    const { error: err } = await supabase.from(TABLE_PRODUCT_VARIANTS).update(payload).eq("id", row.id);
    if (err) {
      setSaving(false);
      toast.error(err.message || "更新規格失敗");
      setError(err.message || "更新規格失敗");
      return;
    }
    for (const ch of channels) {
      const raw = (channelPrices[ch.id] ?? "").trim();
      const num = raw === "" ? NaN : Number(raw);
      if (Number.isFinite(num) && num >= 0) {
        const { error: upsertErr } = await supabase.from("product_variant_channel_prices").upsert(
          { variant_id: row.id, channel_id: ch.id, price: num },
          { onConflict: "variant_id,channel_id" }
        );
        if (upsertErr) toast.error(`通路「${ch.name}」售價儲存失敗：${upsertErr.message}`);
      } else {
        await supabase.from("product_variant_channel_prices").delete().eq("variant_id", row.id).eq("channel_id", ch.id);
      }
    }
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
                <option value="白橡木" />
                <option value="胡桃木" />
                <option value="柚木" />
                <option value="雞翅木" />
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
