"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import type { VariantRow } from "@/types/products";
import { supabase } from "@/lib/supabase";

export interface ViewVariantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: VariantRow | null;
}

interface ChannelPriceRow {
  channel_id: string;
  name: string;
  price: number;
}

function formatDim(v: VariantRow): string {
  const w = v.dimension_w != null ? v.dimension_w : "";
  const d = v.dimension_d != null ? v.dimension_d : "";
  const h = v.dimension_h != null ? v.dimension_h : "";
  const parts = [w, d, h].filter((x) => x !== "");
  if (parts.length === 0) return "—";
  return `W:${parts[0]} x D:${parts[1] ?? "—"} x H:${parts[2] ?? "—"}`;
}

export function ViewVariantDialog({ open, onOpenChange, row }: ViewVariantDialogProps) {
  const [channelPrices, setChannelPrices] = useState<ChannelPriceRow[]>([]);

  useEffect(() => {
    if (!open || !row) return;
    if (row.base_price == null) {
      setChannelPrices([]);
      return;
    }
    (async () => {
      const [chRes, discountRes, overrideRes] = await Promise.all([
        supabase.from("channels").select("id, name").order("sort_order").order("name"),
        supabase
          .from("product_series_channel_discounts")
          .select("channel_id, discount_percent")
          .eq("series_id", row.series_id),
        supabase
          .from("product_variant_channel_prices")
          .select("channel_id, price")
          .eq("variant_id", row.id),
      ]);
      const channels = ((chRes.data ?? []) as { id: string; name: string }[]).map((c) => ({
        id: String(c.id),
        name: String(c.name ?? ""),
      }));
      const discountMap: Record<string, number> = {};
      ((discountRes.data ?? []) as { channel_id: string; discount_percent: number }[]).forEach((d) => {
        discountMap[String(d.channel_id)] = Number(d.discount_percent ?? 0);
      });
      const overrideMap: Record<string, number> = {};
      ((overrideRes.data ?? []) as { channel_id: string; price: number }[]).forEach((p) => {
        overrideMap[String(p.channel_id)] = Number(p.price);
      });
      const base = Number(row.base_price);
      const list: ChannelPriceRow[] = [];
      channels.forEach((ch) => {
        let price: number | null = null;
        if (overrideMap[ch.id] != null && !Number.isNaN(overrideMap[ch.id])) {
          price = overrideMap[ch.id];
        } else if (discountMap[ch.id] != null) {
          const pct = discountMap[ch.id];
          price = Math.round(base * (1 - pct / 100));
        }
        if (price != null && Number.isFinite(price)) {
          list.push({ channel_id: ch.id, name: ch.name, price });
        }
      });
      setChannelPrices(list);
    })();
  }, [open, row]);

  if (!row) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="view-variant-desc"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">規格總覽 — {row.product_code || "—"}</Dialog.Title>
              <p id="view-variant-desc" className="mt-0.5 text-sm text-muted-foreground">規格詳情</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div><dt className="text-muted-foreground">代碼</dt><dd className="font-medium">{row.product_code || "—"}</dd></div>
            <div><dt className="text-muted-foreground">木種</dt><dd>{row.wood_type || "—"}</dd></div>
            <div><dt className="text-muted-foreground">尺寸</dt><dd>{formatDim(row)}</dd></div>
            <div><dt className="text-muted-foreground">面積</dt><dd>{row.desktop_area != null ? row.desktop_area : "—"}</dd></div>
            <div><dt className="text-muted-foreground">基礎定價</dt><dd>{row.base_price != null ? row.base_price.toLocaleString() : "—"}</dd></div>
            <div>
              <dt className="text-muted-foreground">通路價格</dt>
              <dd>
                {row.base_price == null
                  ? "—"
                  : channelPrices.length === 0
                  ? "尚未設定"
                  : (
                    <ul className="mt-1 space-y-0.5">
                      {channelPrices.map((cp) => (
                        <li key={cp.channel_id}>
                          {cp.name}: {cp.price.toLocaleString()}
                        </li>
                      ))}
                    </ul>
                  )}
              </dd>
            </div>
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
