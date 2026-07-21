"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { SalesInvoiceRow } from "@/lib/sales-invoice";
import {
  buildSalesTaxMediaFile,
  fetchCompanySettings,
  periodLabel,
  periodStartMonth,
  saveCompanySettings,
} from "@/lib/tax-media-file";

export interface ExportSalesTaxMediaDialogProps {
  /** 全部銷項發票（未套用畫面篩選） */
  invoices: SalesInvoiceRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 匯出完成（已標記 exported_at），供外層重新整理 */
  onExported: () => void;
}

/** 產生銷項報稅媒體檔（401 申報用）：選期別→驗證→下載 81 字元 TXT（銷項不可延後申報，無逾期併入選項） */
export function ExportSalesTaxMediaDialog({ invoices, open, onOpenChange, onExported }: ExportSalesTaxMediaDialogProps) {
  const [period, setPeriod] = useState("");
  const [taxId, setTaxId] = useState("");
  const [regNo, setRegNo] = useState("");
  const [exporting, setExporting] = useState(false);

  // 期別選項：由已開立／作廢發票日期推出的雙月期，新→舊
  const periodOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of invoices) {
      if (r.invoice_date && r.status !== "draft") set.add(periodStartMonth(r.invoice_date));
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [invoices]);

  useEffect(() => {
    if (!open) return;
    setExporting(false);
    setPeriod((p) => (p && periodOptions.includes(p) ? p : periodOptions[0] ?? ""));
    void fetchCompanySettings().then((s) => {
      if (s) {
        setTaxId(s.tax_id ?? "");
        setRegNo(s.tax_registration_number ?? "");
      }
    });
  }, [open, periodOptions]);

  /** 期別內的發票：已開立＋已作廢（作廢以零額列報）；草稿另行提醒 */
  const scope = useMemo(() => {
    if (!period) {
      return { selected: [] as SalesInvoiceRow[], drafts: 0, allowances: 0 };
    }
    const startYear = Number(period.slice(0, 4));
    const startMonth = Number(period.slice(5, 7));
    const endMonth = `${startYear}-${String(startMonth + 1).padStart(2, "0")}`;
    const inPeriod = (d: string | null) => {
      const ym = (d ?? "").slice(0, 7);
      return ym === period || ym === endMonth;
    };
    const selected: SalesInvoiceRow[] = [];
    let drafts = 0;
    let allowances = 0;
    for (const r of invoices) {
      if (r.status === "draft") {
        if (inPeriod(r.invoice_date)) drafts += 1;
        continue;
      }
      if (!inPeriod(r.invoice_date)) continue;
      selected.push(r);
      allowances += (r.sales_allowances ?? []).filter((a) => inPeriod(a.allowance_date)).length;
    }
    return { selected, drafts, allowances };
  }, [invoices, period]);

  const result = useMemo(
    () => buildSalesTaxMediaFile(scope.selected, { taxId, taxRegistrationNumber: regNo }),
    [scope.selected, taxId, regNo],
  );

  const totals = useMemo(() => {
    let ex = 0;
    let tax = 0;
    for (const r of scope.selected) {
      if (r.status === "voided") continue;
      ex += r.amount_ex_tax ?? 0;
      tax += r.tax_amount ?? 0;
    }
    return { ex: Math.round(ex), tax: Math.round(tax) };
  }, [scope.selected]);

  async function onDownload() {
    if (!result.content) return;
    setExporting(true);
    try {
      const settingsErr = await saveCompanySettings(taxId, regNo);
      if (settingsErr) console.error("公司稅籍設定儲存失敗:", settingsErr);

      const blob = new Blob([result.content], { type: "text/plain;charset=us-ascii" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);

      const { error } = await supabase
        .from("sales_invoices")
        .update({ exported_at: new Date().toISOString() })
        .in(
          "id",
          scope.selected.map((r) => r.id),
        );
      if (error) {
        toast.error(`媒體檔已下載，但匯出註記寫入失敗：${error.message}`);
      } else {
        toast.success(`已產出 ${periodLabel(period)} 銷項媒體檔（${scope.selected.length} 張），請匯入營業稅申報系統`);
      }
      onOpenChange(false);
      onExported();
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="export-sales-tax-media-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">匯出報稅媒體檔（銷項）</Dialog.Title>
              <p id="export-sales-tax-media-desc" className="mt-1 text-sm text-muted-foreground">
                產出營業人銷項憑證媒體檔（81 字元 TXT），可匯入財政部營業稅電子申報系統
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

          <div className="mt-4 space-y-4">
            {/* 公司稅籍設定（記住上次輸入） */}
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/15 p-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sales-media-tax-id" className="text-xs text-muted-foreground">
                  公司統一編號（8 碼）*
                </label>
                <input
                  id="sales-media-tax-id"
                  type="text"
                  inputMode="numeric"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="12345678"
                  autoComplete="off"
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sales-media-reg-no" className="text-xs text-muted-foreground">
                  稅籍編號（9 碼，見稅籍登記證）*
                </label>
                <input
                  id="sales-media-reg-no"
                  type="text"
                  inputMode="numeric"
                  value={regNo}
                  onChange={(e) => setRegNo(e.target.value)}
                  placeholder="123456789"
                  autoComplete="off"
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="sales-media-period" className="text-xs text-muted-foreground">
                申報期別（依發票日期；含已開立與作廢）
              </label>
              <select
                id="sales-media-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="h-9 w-fit rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {periodOptions.length === 0 && <option value="">（無已開立發票）</option>}
                {periodOptions.map((p) => (
                  <option key={p} value={p}>
                    {periodLabel(p)}
                  </option>
                ))}
              </select>
            </div>

            {/* 統計預覽 */}
            <div className="rounded-lg border border-border bg-muted/15 px-3 py-2.5 text-xs text-foreground">
              {scope.selected.length === 0 ? (
                <p className="text-muted-foreground">此期別沒有可申報的發票。</p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
                  <span>
                    共 <span className="font-semibold">{scope.selected.length}</span> 張
                  </span>
                  {Object.entries(result.countByFormat)
                    .sort()
                    .map(([code, count]) => (
                      <span key={code} className="text-muted-foreground">
                        格式 {code}：{count} 張
                      </span>
                    ))}
                  <span className="text-muted-foreground">未稅 ${totals.ex.toLocaleString()}</span>
                  <span className="text-muted-foreground">稅額 ${totals.tax.toLocaleString()}</span>
                </div>
              )}
            </div>

            {scope.drafts > 0 && (
              <p className="rounded-lg border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
                此期別還有 {scope.drafts} 張草稿未開立，不會列入媒體檔；若應申報請先開立。
              </p>
            )}
            {scope.allowances > 0 && (
              <p className="rounded-lg border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
                此期別有 {scope.allowances} 張折讓單：折讓（格式 33/34）尚未納入媒體檔，請於申報軟體手動輸入折讓資料。
              </p>
            )}

            {result.issues.length > 0 && scope.selected.length > 0 && (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5">
                <p className="text-xs font-medium text-destructive">
                  以下 {result.issues.length} 項未通過檢核，請先修正（點清單的編輯）：
                </p>
                {result.issues.map((issue, i) => (
                  <p key={i} className="text-xs text-destructive">
                    {issue.invoiceNumber}：{issue.message}
                  </p>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              銷項發票不可延後申報，請確認期別內的發票皆已開立完成再產檔；作廢發票會以零額列報。
              下載後請用「營業稅電子資料申報繳稅系統」的媒體檔匯入功能載入。
            </p>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={exporting}>
                  取消
                </Button>
              </Dialog.Close>
              <Button type="button" onClick={onDownload} disabled={exporting || !result.content}>
                {exporting ? "產檔中…" : `下載媒體檔（${result.fileName}）`}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
