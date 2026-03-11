"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { SeriesRow } from "@/types/products";
import { toast } from "sonner";

export interface ChannelOption {
  id: string;
  name: string;
}

export interface EditSeriesChannelDiscountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  series: SeriesRow | null;
  channels: ChannelOption[];
  onSuccess: () => void;
}

export function EditSeriesChannelDiscountDialog({
  open,
  onOpenChange,
  series,
  channels,
  onSuccess,
}: EditSeriesChannelDiscountDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !series) return;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error: err } = await supabase
        .from("product_series_channel_discounts")
        .select("channel_id, discount_percent")
        .eq("series_id", series.id);
      if (err) {
        setLoading(false);
        setError(err.message || "讀取通路折扣失敗");
        return;
      }
      const map: Record<string, string> = {};
      channels.forEach((ch) => {
        map[ch.id] = "";
      });
      (data ?? []).forEach((row: any) => {
        const cid = String(row.channel_id);
        const val = row.discount_percent != null ? String(row.discount_percent) : "";
        map[cid] = val;
      });
      setValues(map);
      setLoading(false);
    })();
  }, [open, series, channels]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!series) return;
    setSaving(true);
    setError(null);
    try {
      for (const ch of channels) {
        const raw = (values[ch.id] ?? "").trim();
        if (!raw) {
          await supabase
            .from("product_series_channel_discounts")
            .delete()
            .eq("series_id", series.id)
            .eq("channel_id", ch.id);
          continue;
        }
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0 || num > 100) {
          throw new Error(`通路「${ch.name}」折扣必須是 0–100 的數字`);
        }
        const { error: upsertErr } = await supabase
          .from("product_series_channel_discounts")
          .upsert(
            {
              series_id: series.id,
              channel_id: ch.id,
              discount_percent: num,
            },
            { onConflict: "series_id,channel_id" }
          );
        if (upsertErr) {
          throw new Error(`通路「${ch.name}」折扣儲存失敗：${upsertErr.message}`);
        }
      }
      toast.success("已更新通路折扣");
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || "儲存通路折扣失敗");
    } finally {
      setSaving(false);
    }
  }

  if (!series) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="edit-series-discount-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                通路折扣設定
              </Dialog.Title>
              <p id="edit-series-discount-desc" className="mt-1 text-sm text-muted-foreground">
                以百分比設定每個通路的折扣，將套用到此系列下所有規格的定價。
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                例如輸入 20 表示 8 折（base price × (1 - 20% )）。
              </p>
              <p className="mt-2 text-xs text-foreground">
                系列：{series.name || "未命名"}
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">載入通路折扣中…</p>
            ) : channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">目前尚未建立任何通路，請先至「通路管理」新增。</p>
            ) : (
              <div className="space-y-2">
                {channels.map((ch) => (
                  <div key={ch.id} className="flex items-center gap-2">
                    <label
                      htmlFor={`series-discount-${ch.id}`}
                      className="w-28 shrink-0 text-xs text-muted-foreground"
                    >
                      {ch.name}
                    </label>
                    <input
                      id={`series-discount-${ch.id}`}
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      value={values[ch.id] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [ch.id]: e.target.value }))
                      }
                      className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="未設定"
                    />
                    <span className="text-xs text-muted-foreground shrink-0">%</span>
                  </div>
                ))}
              </div>
            )}
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={saving}>
                  取消
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving || loading || channels.length === 0}>
                {saving ? "儲存中…" : "儲存"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

