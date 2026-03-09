"use client";

import { useEffect, useState } from "react";
import { X, Globe } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import type { VendorRow } from "@/types/procurement";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface ViewVendorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: VendorRow | null;
}

/** 廠商採購紀錄一筆（用於總覽內列表） */
interface VendorPurchaseItem {
  id: string;
  purchase_date: string;
  item_name: string;
  item_category: string;
  spec: string;
  quantity: string | number;
  unit: string;
  unit_price: number;
  tax_included_amount: number;
}

function googleMapsUrl(address: string | null | undefined): string {
  if (!address?.trim()) return "#";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <dl className="space-y-2.5 text-sm">{children}</dl>
    </section>
  );
}

export function ViewVendorDialog({ open, onOpenChange, row }: ViewVendorDialogProps) {
  const [purchases, setPurchases] = useState<VendorPurchaseItem[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);

  useEffect(() => {
    if (!open || !row) {
      setPurchases([]);
      return;
    }
    let cancelled = false;
    setPurchasesLoading(true);
    (async () => {
      // 先依廠商名稱篩選（purchases 表有 vendor_name 時）
      let { data, error } = await supabase
        .from("purchases")
        .select("id, purchase_date, item_name, item_category, spec, quantity, unit, unit_price, tax_included_amount, vendor_name")
        .eq("vendor_name", row.name)
        .order("purchase_date", { ascending: false });

      const mapRow = (r: Record<string, unknown>) => ({
        id: String(r.id),
        purchase_date: String(r.purchase_date ?? ""),
        item_name: String(r.item_name ?? ""),
        item_category: String(r.item_category ?? ""),
        spec: String(r.spec ?? ""),
        quantity: (r.quantity ?? "") as string | number,
        unit: String(r.unit ?? ""),
        unit_price: Number(r.unit_price) || 0,
        tax_included_amount: Number(r.tax_included_amount) || 0,
      });

      if (!cancelled && !error && data?.length) {
        setPurchases(data.map((d) => mapRow(d as Record<string, unknown>)));
      } else {
        // 再試 vendor_id（purchases 表有 vendor_id 時）
        const res = await supabase
          .from("purchases")
          .select("id, purchase_date, item_name, item_category, spec, quantity, unit, unit_price, tax_included_amount")
          .eq("vendor_id", row.id)
          .order("purchase_date", { ascending: false });
        if (!cancelled) {
          if (!res.error && res.data?.length) {
            setPurchases(res.data.map((d) => mapRow(d as Record<string, unknown>)));
          } else {
            setPurchases([]);
          }
        }
      }
      if (!cancelled) setPurchasesLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, row?.id, row?.name]);

  if (!row) return null;

  const hasAddress = row.address?.trim();
  const hasEmail = row.email?.trim();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="view-vendor-desc"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">廠商總覽 — {row.name || "—"}</Dialog.Title>
              <p id="view-vendor-desc" className="mt-0.5 text-sm text-muted-foreground">基本資料與聯絡方式</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <div className="mt-4 space-y-5">
            <Section title="基本資料">
              <div><dt className="text-muted-foreground">廠商名稱</dt><dd className="font-medium">{row.name || "—"}</dd></div>
              <div><dt className="text-muted-foreground">類別</dt><dd>{row.main_category || "—"}</dd></div>
              {row.contact_person?.trim() && <div><dt className="text-muted-foreground">聯絡人</dt><dd>{row.contact_person}</dd></div>}
            </Section>
            <Section title="聯絡方式">
              <div>
                <dt className="text-muted-foreground">地址</dt>
                <dd className="whitespace-pre-wrap">
                  {hasAddress ? (
                    <a href={googleMapsUrl(row.address)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" title="在 Google 地圖開啟">
                      {row.address}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div><dt className="text-muted-foreground">電話</dt><dd>{row.phone || "—"}</dd></div>
              {(row.fax?.trim() ?? "") && <div><dt className="text-muted-foreground">傳真</dt><dd>{row.fax}</dd></div>}
              {hasEmail ? (
                <div>
                  <dt className="text-muted-foreground">EMAIL</dt>
                  <dd>
                    <a href={`mailto:${row.email!.trim()}`} className="text-primary hover:underline" title="以 Gmail / 郵件軟體寄信">
                      {row.email}
                    </a>
                  </dd>
                </div>
              ) : null}
              {row.website?.trim() ? (
                <div>
                  <dt className="text-muted-foreground">網站</dt>
                  <dd>
                    <a
                      href={row.website.trim().startsWith("http") ? row.website.trim() : `https://${row.website.trim()}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                      title="開啟網站"
                    >
                      <Globe className="h-4 w-4 shrink-0" />
                      {row.website.trim()}
                    </a>
                  </dd>
                </div>
              ) : null}
              {(row.tax_id?.trim() ?? "") && <div><dt className="text-muted-foreground">統一編號</dt><dd>{row.tax_id}</dd></div>}
            </Section>
            {row.notes?.trim() && <Section title="備註"><div><dd className="whitespace-pre-wrap text-muted-foreground">{row.notes}</dd></div></Section>}
            <Section title="採購紀錄">
              {purchasesLoading ? (
                <p className="text-sm text-muted-foreground">載入中…</p>
              ) : purchases.length === 0 ? (
                <p className="text-sm text-muted-foreground">尚無採購紀錄</p>
              ) : (
                <div className="rounded-lg border border-border overflow-x-auto overflow-y-hidden">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-b border-border bg-muted/30">
                        <TableHead className="text-xs font-semibold p-2">日期</TableHead>
                        <TableHead className="text-xs font-semibold p-2">品名</TableHead>
                        <TableHead className="text-xs font-semibold p-2">物品類別</TableHead>
                        <TableHead className="text-xs font-semibold p-2">規格</TableHead>
                        <TableHead className="text-xs font-semibold p-2 text-right">數量</TableHead>
                        <TableHead className="text-xs font-semibold p-2">單位</TableHead>
                        <TableHead className="text-xs font-semibold p-2 text-right">單價</TableHead>
                        <TableHead className="text-xs font-semibold p-2 text-right">含稅總價</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {purchases.map((p) => (
                        <TableRow key={p.id} className="border-b border-border last:border-0">
                          <TableCell className="text-xs p-2 whitespace-nowrap">{formatDate(p.purchase_date)}</TableCell>
                          <TableCell className="text-xs p-2">{p.item_name || "—"}</TableCell>
                          <TableCell className="text-xs p-2 text-muted-foreground">{p.item_category || "—"}</TableCell>
                          <TableCell className="text-xs p-2 text-muted-foreground">{p.spec || "—"}</TableCell>
                          <TableCell className="text-xs p-2 text-right">{p.quantity}</TableCell>
                          <TableCell className="text-xs p-2">{p.unit || "—"}</TableCell>
                          <TableCell className="text-xs p-2 text-right tabular-nums">{typeof p.unit_price === "number" ? p.unit_price.toLocaleString() : "—"}</TableCell>
                          <TableCell className="text-xs p-2 text-right tabular-nums font-medium">{p.tax_included_amount?.toLocaleString() ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
