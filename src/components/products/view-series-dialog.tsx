"use client";

import { useState } from "react";
import { X, Copy, Globe, FileText, Package } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { SeriesRow, VariantRow } from "@/types/products";
import { cn } from "@/lib/utils";

export interface ViewSeriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: SeriesRow | null;
  variants: VariantRow[];
}

type ViewTab = "overview" | "content" | "variants";

function formatDim(v: VariantRow): string {
  const w = v.dimension_w != null ? v.dimension_w : "";
  const d = v.dimension_d != null ? v.dimension_d : "";
  const h = v.dimension_h != null ? v.dimension_h : "";
  const parts = [w, d, h].filter((x) => x !== "");
  if (parts.length === 0) return "—";
  return `W:${parts[0]} x D:${parts[1] ?? "—"} x H:${parts[2] ?? "—"}`;
}

function TextBlock({ title, content }: { title: string; content: string | null | undefined }) {
  const text = content?.trim() ?? "";
  if (!text) return null;
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已複製到剪貼簿");
    } catch {
      toast.error("複製失敗");
    }
  }
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          className="h-7 px-2 shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={handleCopy}
          aria-label={`複製${title}`}
        >
          <Copy className="h-3.5 w-3.5" />
          複製
        </Button>
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground">{text}</p>
    </section>
  );
}

export function ViewSeriesDialog({ open, onOpenChange, row, variants }: ViewSeriesDialogProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>("overview");

  if (!row) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-lg focus:outline-none flex flex-col"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="view-series-desc"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 pt-5 pb-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                系列總覽 — {row.name || "—"}
              </Dialog.Title>
              <p id="view-series-desc" className="mt-0.5 text-sm text-muted-foreground">
                {row.category ? `類別：${row.category}` : ""} {row.notes?.trim() ? ` · ${row.notes}` : ""}
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex border-b border-border bg-muted/20 px-5">
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === "overview"
                  ? "border-b-2 border-primary bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Package className="h-4 w-4" />
              基本資料
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("content")}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === "content"
                  ? "border-b-2 border-primary bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <FileText className="h-4 w-4" />
              文案
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("variants")}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === "variants"
                  ? "border-b-2 border-primary bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              規格一覽
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {activeTab === "overview" && (
              <div className="space-y-4">
                <section className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    系列資訊
                  </h3>
                  <p className="text-sm text-foreground">
                    {row.category ? `類別：${row.category}` : "類別：—"}
                    {row.production_time?.trim() ? ` · 交期：約 ${row.production_time} 週` : ""}
                  </p>
                  {row.code_rule?.trim() && (
                    <p className="text-sm text-muted-foreground">編碼原則：{row.code_rule}</p>
                  )}
                  {row.notes?.trim() && (
                    <p className="text-sm text-muted-foreground">備註：{row.notes}</p>
                  )}
                </section>

                {row.website?.trim() && (
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      網站
                    </h3>
                    <a
                      href={
                        row.website.trim().startsWith("http")
                          ? row.website.trim()
                          : `https://${row.website.trim()}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <Globe className="h-4 w-4 shrink-0" />
                      {row.website.trim()}
                    </a>
                  </section>
                )}
              </div>
            )}

            {activeTab === "content" && (
              <div className="space-y-5">
                <TextBlock title="設計理念" content={row.design_concept} />
                <TextBlock title="社群貼文" content={row.social_media_copy} />
                <TextBlock title="網站文章" content={row.website_article} />
                <TextBlock title="客服問答" content={row.faq_scripts} />
                <TextBlock title="客製與保養" content={row.customization_rules} />
              </div>
            )}

            {activeTab === "variants" && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  規格一覽
                </h3>
                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-b border-border">
                        <TableHead className="text-xs font-semibold p-2">代碼</TableHead>
                        <TableHead className="text-xs font-semibold p-2">木種</TableHead>
                        <TableHead className="text-xs font-semibold p-2">尺寸</TableHead>
                        <TableHead className="text-xs font-semibold p-2">面積</TableHead>
                        <TableHead className="text-xs font-semibold p-2">基礎定價</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {variants.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="text-center text-muted-foreground text-sm p-4"
                          >
                            尚無規格
                          </TableCell>
                        </TableRow>
                      ) : (
                        variants.map((v) => (
                          <TableRow key={v.id} className="border-b border-border last:border-0">
                            <TableCell className="text-sm p-2">
                              {v.product_code || "—"}
                            </TableCell>
                            <TableCell className="text-sm p-2">{v.wood_type || "—"}</TableCell>
                            <TableCell className="text-sm p-2">{formatDim(v)}</TableCell>
                            <TableCell className="text-sm p-2">
                              {v.desktop_area != null ? v.desktop_area : "—"}
                            </TableCell>
                            <TableCell className="text-sm p-2">
                              {v.base_price != null ? v.base_price.toLocaleString() : "—"}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
