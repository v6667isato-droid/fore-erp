"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { invoiceOwnerCategory, type AccountingInvoiceRow } from "@/lib/accounting-invoice";
import {
  buildTaxMediaFile,
  fetchCompanySettings,
  periodLabel,
  periodStartMonth,
  saveCompanySettings,
} from "@/lib/tax-media-file";

export interface ExportTaxMediaDialogProps {
  /** 全部已存檔發票（未套用畫面篩選；家庭發票會在本元件內排除） */
  invoices: AccountingInvoiceRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 匯出完成（已標記 exported_at），供外層重新整理 */
  onExported: () => void;
}

/** 產生報稅媒體檔（進項 401 申報用）：選期別→驗證→下載 81 字元 TXT */
export function ExportTaxMediaDialog({ invoices, open, onOpenChange, onExported }: ExportTaxMediaDialogProps) {
  const [period, setPeriod] = useState("");
  const [includeCarryOver, setIncludeCarryOver] = useState(true);
  const [taxId, setTaxId] = useState("");
  const [regNo, setRegNo] = useState("");
  const [exporting, setExporting] = useState(false);

  /**
   * 只申報公司發票（有買方統編）。家庭發票沒有買方統編、不能扣抵進項，
   * 若一併匯出會被蓋上公司統編變成不實申報，因此在此排除。
   * 買方統編「有填但與公司統編不符」仍留給 buildTaxMediaFile 擋下並列出原因。
   */
  const declarable = useMemo(
    () => invoices.filter((r) => invoiceOwnerCategory(r.buyer_tax_id) === "company"),
    [invoices],
  );
  const familyExcluded = invoices.length - declarable.length;

  // 期別選項：由可申報發票日期推出的雙月期，新→舊
  const periodOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of declarable) {
      if (r.invoice_date) set.add(periodStartMonth(r.invoice_date));
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [declarable]);

  useEffect(() => {
    if (!open) return;
    setExporting(false);
    setIncludeCarryOver(true);
    setPeriod((p) => (p && periodOptions.includes(p) ? p : periodOptions[0] ?? ""));
    void fetchCompanySettings().then((s) => {
      if (s) {
        setTaxId(s.tax_id ?? "");
        setRegNo(s.tax_registration_number ?? "");
      }
    });
  }, [open, periodOptions]);

  /** 期別內全部發票＋（可選）之前期別尚未匯出的逾期憑證（進項可延後申報） */
  const scope = useMemo(() => {
    if (!period) return { inPeriod: [] as AccountingInvoiceRow[], carryOver: [] as AccountingInvoiceRow[] };
    const startYear = Number(period.slice(0, 4));
    const startMonth = Number(period.slice(5, 7));
    const endMonth = `${startYear}-${String(startMonth + 1).padStart(2, "0")}`;
    const inPeriod: AccountingInvoiceRow[] = [];
    const carryOver: AccountingInvoiceRow[] = [];
    for (const r of declarable) {
      if (!r.invoice_date) continue;
      const ym = r.invoice_date.slice(0, 7);
      if (ym === period || ym === endMonth) inPeriod.push(r);
      else if (ym < period && r.exported_at == null) carryOver.push(r);
    }
    return { inPeriod, carryOver };
  }, [declarable, period]);

  const selected = useMemo(
    () => (includeCarryOver ? [...scope.inPeriod, ...scope.carryOver] : scope.inPeriod),
    [scope, includeCarryOver],
  );

  // 逐張預檢：有 issue 就擋下載並列出原因
  const result = useMemo(
    () => buildTaxMediaFile(selected, { taxId, taxRegistrationNumber: regNo }),
    [selected, taxId, regNo],
  );

  const totals = useMemo(() => {
    let ex = 0;
    let tax = 0;
    for (const r of selected) {
      ex += r.amount_ex_tax ?? 0;
      tax += r.tax_amount ?? 0;
    }
    return { ex: Math.round(ex), tax: Math.round(tax) };
  }, [selected]);

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
        .from("accounting_invoices")
        .update({ exported_at: new Date().toISOString() })
        .in(
          "id",
          selected.map((r) => r.id),
        );
      if (error) {
        toast.error(`媒體檔已下載，但匯出註記寫入失敗：${error.message}`);
      } else {
        toast.success(`已產出 ${periodLabel(period)} 媒體檔（${selected.length} 張），請匯入營業稅申報系統`);
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
          aria-describedby="export-tax-media-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">匯出報稅媒體檔（進項）</Dialog.Title>
              <p id="export-tax-media-desc" className="mt-1 text-sm text-muted-foreground">
                產出營業人進項憑證媒體檔（81 字元 TXT），可匯入財政部營業稅電子申報系統；只收有買方統編的公司發票
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
                <label htmlFor="tax-media-tax-id" className="text-xs text-muted-foreground">
                  公司統一編號（8 碼）*
                </label>
                <input
                  id="tax-media-tax-id"
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
                <label htmlFor="tax-media-reg-no" className="text-xs text-muted-foreground">
                  稅籍編號（9 碼，見稅籍登記證）*
                </label>
                <input
                  id="tax-media-reg-no"
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

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tax-media-period" className="text-xs text-muted-foreground">
                  申報期別（依發票日期）
                </label>
                <select
                  id="tax-media-period"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {periodOptions.length === 0 && <option value="">（無已存檔發票）</option>}
                  {periodOptions.map((p) => (
                    <option key={p} value={p}>
                      {periodLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
              {scope.carryOver.length > 0 && (
                <label className="flex h-9 items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={includeCarryOver}
                    onChange={(e) => setIncludeCarryOver(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  一併申報之前期別未匯出的 {scope.carryOver.length} 張（逾期取得憑證）
                </label>
              )}
            </div>

            {/* 統計預覽 */}
            <div className="rounded-lg border border-border bg-muted/15 px-3 py-2.5 text-xs text-foreground">
              {selected.length === 0 ? (
                <p className="text-muted-foreground">此期別沒有可申報的發票。</p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
                  <span>
                    共 <span className="font-semibold">{selected.length}</span> 張
                  </span>
                  {familyExcluded > 0 && (
                    <span className="text-muted-foreground" title="無買方統編、不可扣抵進項，不列入申報">
                      已排除家庭發票 {familyExcluded} 張
                    </span>
                  )}
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

            {result.issues.length > 0 && selected.length > 0 && (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5">
                <p className="text-xs font-medium text-destructive">
                  以下 {result.issues.length} 項未通過檢核，請先修正（點已存檔清單的編輯）：
                </p>
                {result.issues.map((issue, i) => (
                  <p key={i} className="text-xs text-destructive">
                    {issue.invoiceNumber}：{issue.message}
                  </p>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              下載後請用「營業稅電子資料申報繳稅系統」的媒體檔匯入功能載入；首次使用建議先匯入測試一次，
              確認申報軟體讀得到再正式申報。
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
