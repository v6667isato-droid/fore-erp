"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  isValidInvoiceNumber,
  normalizeInvoiceNumber,
  TAX_TYPE_OPTIONS,
} from "@/lib/accounting-invoice";
import {
  amegoBanQuery,
  amegoIssueInvoice,
  calcInvoiceTotals,
  CARRIER_TYPE_OPTIONS,
  fetchSalesInvoiceItems,
  SALES_STATUS_LABELS,
  type SalesInvoiceRow,
  type SalesInvoiceType,
} from "@/lib/sales-invoice";

/** 從 Supabase 錯誤物件盡量取出可讀訊息 */
function errText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}

interface LineInput {
  key: string;
  order_item_id: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
}

function lineAmount(line: LineInput): number {
  const q = Number(line.quantity);
  const p = Number(line.unitPrice);
  if (Number.isNaN(q) || Number.isNaN(p)) return 0;
  return Math.round(q * p * 100) / 100;
}

let lineKeySeq = 0;
function nextLineKey(): string {
  lineKeySeq += 1;
  return `line-${lineKeySeq}`;
}

function emptyLine(): LineInput {
  return { key: nextLineKey(), order_item_id: null, description: "", quantity: "1", unitPrice: "" };
}

/** 由訂單開票時帶入的訂單摘要 */
export interface SalesInvoiceOrderContext {
  id: string;
  order_number: string;
  customer_id: string | null;
}

export interface SalesInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 檢視／編輯既有發票；null 表示新開 */
  invoice?: SalesInvoiceRow | null;
  /** 由訂單開票（新開時預填買方與品項） */
  order?: SalesInvoiceOrderContext | null;
  /** 純檢視（不可編輯、不顯示存檔按鈕） */
  readOnly?: boolean;
  onSaved: () => void;
}

interface OrderPrefill {
  depositAmount: number;
  lines: LineInput[];
}

export function SalesInvoiceDialog({ open, onOpenChange, invoice, order, readOnly: readOnlyProp, onSaved }: SalesInvoiceDialogProps) {
  const isEdit = invoice != null;
  const readOnly = readOnlyProp || invoice?.status === "voided";

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingPrefill, setLoadingPrefill] = useState(false);
  const [orderPrefill, setOrderPrefill] = useState<OrderPrefill | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  /** 新開模式下已建立的草稿 id（光賀開立失敗後重試時避免重複建檔） */
  const [createdId, setCreatedId] = useState<string | null>(null);

  const [invoiceType, setInvoiceType] = useState<SalesInvoiceType>("B2B");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerTaxId, setBuyerTaxId] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [carrierType, setCarrierType] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [donationCode, setDonationCode] = useState("");
  const [printFlag, setPrintFlag] = useState(false);
  const [taxType, setTaxType] = useState(1);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineInput[]>([emptyLine()]);

  // 開啟時預填：編輯模式載入既有欄位與明細；由訂單開票則抓訂單／客戶／品項
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setDuplicateOf(null);
    setOrderPrefill(null);
    setCreatedId(null);

    if (invoice) {
      setInvoiceType(invoice.invoice_type);
      setInvoiceNumber(invoice.invoice_number ?? "");
      setInvoiceDate(invoice.invoice_date ?? "");
      setBuyerName(invoice.buyer_name ?? "");
      setBuyerTaxId(invoice.buyer_tax_id ?? "");
      setBuyerEmail(invoice.buyer_email ?? "");
      setCarrierType(invoice.carrier_type ?? "");
      setCarrierId(invoice.carrier_id ?? "");
      setDonationCode(invoice.donation_code ?? "");
      setPrintFlag(invoice.print_flag);
      setTaxType(invoice.tax_type);
      setNotes(invoice.notes ?? "");
      setLines([emptyLine()]);
      void fetchSalesInvoiceItems(invoice.id).then((items) => {
        if (items.length === 0) return;
        setLines(
          items.map((it) => ({
            key: nextLineKey(),
            order_item_id: it.order_item_id,
            description: it.description,
            quantity: String(it.quantity),
            unitPrice: it.unit_price != null ? String(it.unit_price) : String(it.amount),
          })),
        );
      });
      return;
    }

    // 新開發票預設值
    setInvoiceType("B2B");
    setInvoiceNumber("");
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setBuyerName("");
    setBuyerTaxId("");
    setBuyerEmail("");
    setCarrierType("");
    setCarrierId("");
    setDonationCode("");
    setPrintFlag(false);
    setTaxType(1);
    setNotes("");
    setLines([emptyLine()]);

    if (!order) return;
    setLoadingPrefill(true);
    void (async () => {
      try {
        const [orderRes, itemsRes, customerRes] = await Promise.all([
          supabase
            .from("orders")
            .select("id, deposit_amount, shipping_fee")
            .eq("id", order.id)
            .maybeSingle(),
          supabase
            .from("order_items")
            .select(
              "id, quantity, unit_price, channel_unit_price, custom_name, custom_category, line_order, product_variants (product_code, product_series (name))",
            )
            .eq("order_id", order.id)
            .order("line_order", { ascending: true }),
          order.customer_id
            ? supabase
                .from("customers")
                .select("name, company, tax_id, invoice_title, invoice_email, invoice_carrier, contact_method")
                .eq("id", order.customer_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);

        const customer = customerRes.data as {
          name: string;
          company: string | null;
          tax_id: string | null;
          invoice_title: string | null;
          invoice_email: string | null;
          invoice_carrier: string | null;
        } | null;
        if (customer) {
          const hasTaxId = Boolean(customer.tax_id?.trim());
          setInvoiceType(hasTaxId ? "B2B" : "B2C");
          setBuyerName(customer.invoice_title?.trim() || customer.company?.trim() || customer.name);
          setBuyerTaxId(customer.tax_id ?? "");
          setBuyerEmail(customer.invoice_email ?? "");
          if (!hasTaxId && customer.invoice_carrier?.trim()) {
            setCarrierType("3J0002");
            setCarrierId(customer.invoice_carrier.trim());
          }
        }

        type ItemRow = {
          id: string;
          quantity: number;
          unit_price: number;
          channel_unit_price: number | null;
          custom_name: string | null;
          custom_category: string | null;
          product_variants: { product_code: string; product_series: { name: string } | null } | null;
        };
        const items = (itemsRes.data ?? []) as unknown as ItemRow[];
        const itemLines: LineInput[] = items.map((it) => {
          const seriesName = it.product_variants?.product_series?.name ?? "";
          const fallback = [seriesName, it.product_variants?.product_code ?? ""].filter(Boolean).join(" ");
          return {
            key: nextLineKey(),
            order_item_id: it.id,
            description: it.custom_name?.trim() || fallback || "商品",
            quantity: String(it.quantity),
            unitPrice: String(it.channel_unit_price ?? it.unit_price),
          };
        });
        const orderRow = orderRes.data as { deposit_amount: number | null; shipping_fee: number | null } | null;
        if (orderRow?.shipping_fee && orderRow.shipping_fee > 0) {
          itemLines.push({
            key: nextLineKey(),
            order_item_id: null,
            description: "運費",
            quantity: "1",
            unitPrice: String(orderRow.shipping_fee),
          });
        }
        if (itemLines.length > 0) setLines(itemLines);
        setOrderPrefill({ depositAmount: orderRow?.deposit_amount ?? 0, lines: itemLines });
      } catch (err) {
        console.error("訂單預填失敗:", err);
      } finally {
        setLoadingPrefill(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在開啟時預填一次
  }, [open, invoice?.id, order?.id]);

  // 發票號碼重複檢查（其他未刪除發票）
  useEffect(() => {
    if (!open) return;
    const normalized = normalizeInvoiceNumber(invoiceNumber);
    if (!isValidInvoiceNumber(normalized)) {
      setDuplicateOf(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      let query = supabase
        .from("sales_invoices")
        .select("id, buyer_name, invoice_date")
        .eq("invoice_number", normalized)
        .is("deleted_at", null)
        .limit(1);
      if (invoice) query = query.neq("id", invoice.id);
      const { data } = await query;
      if (cancelled) return;
      const hit = (data ?? [])[0] as { buyer_name: string | null; invoice_date: string | null } | undefined;
      setDuplicateOf(hit ? `${hit.buyer_name ?? "（無買方）"}／${hit.invoice_date ?? "（無日期）"}` : null);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, invoice, invoiceNumber]);

  const lineSum = useMemo(() => lines.reduce((acc, l) => acc + lineAmount(l), 0), [lines]);
  const totals = useMemo(() => calcInvoiceTotals(invoiceType, taxType, lineSum), [invoiceType, taxType, lineSum]);

  function updateLine(key: string, patch: Partial<LineInput>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /** 拆開訂金開票：明細改為單列「訂金」 */
  function useDepositLine() {
    if (!orderPrefill || orderPrefill.depositAmount <= 0) return;
    setLines([
      {
        key: nextLineKey(),
        order_item_id: null,
        description: `訂金（訂單 ${order?.order_number ?? ""}）`.trim(),
        quantity: "1",
        unitPrice: String(orderPrefill.depositAmount),
      },
    ]);
  }

  /** 尾款＝訂單品項總額（含運費）－訂金 */
  const balanceAmount = useMemo(() => {
    if (!orderPrefill || orderPrefill.depositAmount <= 0) return 0;
    const orderTotal = orderPrefill.lines.reduce((acc, l) => acc + lineAmount(l), 0);
    return Math.round((orderTotal - orderPrefill.depositAmount) * 100) / 100;
  }, [orderPrefill]);

  /** 拆開尾款開票：明細改為單列「尾款」 */
  function useBalanceLine() {
    if (balanceAmount <= 0) return;
    setLines([
      {
        key: nextLineKey(),
        order_item_id: null,
        description: `尾款（訂單 ${order?.order_number ?? ""}）`.trim(),
        quantity: "1",
        unitPrice: String(balanceAmount),
      },
    ]);
  }

  /** 還原為訂單全部品項 */
  function useOrderLines() {
    if (!orderPrefill || orderPrefill.lines.length === 0) return;
    setLines(orderPrefill.lines.map((l) => ({ ...l, key: nextLineKey() })));
  }

  /** B2B 明細應為未稅：把目前（含稅）單價全部 ÷1.05 */
  function convertLinesToExTax() {
    setLines((prev) =>
      prev.map((l) => {
        const p = Number(l.unitPrice);
        if (Number.isNaN(p) || p <= 0) return l;
        return { ...l, unitPrice: String(Math.round(p / 1.05)) };
      }),
    );
  }

  async function save(issue: boolean) {
    setError(null);
    const normalized = normalizeInvoiceNumber(invoiceNumber);
    const hasNumber = invoiceNumber.trim().length > 0;
    /** 開立且未填號碼＝透過光賀自動配號 */
    const viaAmego = issue && !hasNumber;

    if (hasNumber && !isValidInvoiceNumber(normalized)) {
      setError("發票號碼格式應為 2 碼英文＋8 碼數字（如 AB-12345678）");
      return;
    }
    if (hasNumber && duplicateOf) {
      setError(`發票號碼 ${normalized} 已登記過（${duplicateOf}）`);
      return;
    }
    if (issue && !viaAmego && !invoiceDate.trim()) {
      setError("登記手開發票需輸入發票日期");
      return;
    }
    if (invoiceType === "B2B") {
      if (!buyerTaxId.trim() || !/^\d{8}$/.test(buyerTaxId.trim())) {
        setError("B2B 發票需輸入買方統編（8 碼數字）");
        return;
      }
      if (!buyerName.trim()) {
        setError("B2B 發票需輸入買方抬頭");
        return;
      }
    }
    if (invoiceType === "B2C" && donationCode.trim() && (carrierType || printFlag)) {
      setError("捐贈發票不可同時選載具或印紙本");
      return;
    }
    const validLines = lines.filter((l) => l.description.trim() && lineAmount(l) !== 0);
    if (validLines.length === 0) {
      setError("請至少輸入一列品項（品名與金額）");
      return;
    }

    setSaving(true);
    try {
      // 光賀配號：先存成草稿，開立成功後由伺服器端回寫號碼與狀態
      const status = issue && !viaAmego ? "issued" : invoice?.status ?? "draft";
      const payload = {
        order_id: invoice ? invoice.order_id : order?.id ?? null,
        invoice_type: invoiceType,
        invoice_number: hasNumber ? normalized : null,
        invoice_date: invoiceDate.trim() || null,
        buyer_name: buyerName.trim() || null,
        buyer_tax_id: invoiceType === "B2B" ? buyerTaxId.trim() : null,
        buyer_email: buyerEmail.trim() || null,
        carrier_type: invoiceType === "B2C" && carrierType ? carrierType : null,
        carrier_id: invoiceType === "B2C" && carrierType ? carrierId.trim() || null : null,
        donation_code: invoiceType === "B2C" ? donationCode.trim() || null : null,
        print_flag: invoiceType === "B2C" ? printFlag : false,
        tax_type: taxType,
        amount_ex_tax: totals.amount_ex_tax,
        tax_amount: totals.tax_amount,
        amount_inc_tax: totals.amount_inc_tax,
        status,
        issued_at:
          issue && !viaAmego && invoice?.issued_at == null ? new Date().toISOString() : invoice?.issued_at ?? null,
        notes: notes.trim() || null,
      };

      let invoiceId = invoice?.id ?? createdId;
      if (invoiceId) {
        const { error: updErr } = await supabase.from("sales_invoices").update(payload).eq("id", invoiceId);
        if (updErr) throw updErr;
        const { error: delErr } = await supabase.from("sales_invoice_items").delete().eq("invoice_id", invoiceId);
        if (delErr) throw delErr;
      } else {
        const { data, error: insErr } = await supabase
          .from("sales_invoices")
          .insert(payload)
          .select("id")
          .single();
        if (insErr) throw insErr;
        invoiceId = (data as { id: string }).id;
        setCreatedId(invoiceId);
      }

      const { error: itemsErr } = await supabase.from("sales_invoice_items").insert(
        validLines.map((l, i) => ({
          invoice_id: invoiceId,
          order_item_id: l.order_item_id,
          description: l.description.trim(),
          quantity: Number(l.quantity) || 1,
          unit_price: Number(l.unitPrice) || null,
          amount: lineAmount(l),
          sort_order: i,
        })),
      );
      if (itemsErr) throw itemsErr;

      if (viaAmego) {
        const res = await amegoIssueInvoice(invoiceId!);
        if (!res.ok) {
          setError(res.error);
          toast.error(res.error);
          onSaved(); // 草稿已建立，讓列表同步
          return;
        }
        toast.success(
          `發票 ${res.invoice_number} 已由光賀開立${res.environment === "test" ? "（測試環境）" : ""}`,
        );
        onOpenChange(false);
        onSaved();
        return;
      }

      toast.success(
        issue
          ? `發票 ${normalized} 已登記（手開發票）`
          : `發票${hasNumber ? ` ${normalized}` : ""}已儲存為${SALES_STATUS_LABELS[status as keyof typeof SALES_STATUS_LABELS] ?? status}`,
      );
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error(err);
      if (err && /duplicate key|unique/i.test(errText(err, ""))) {
        setError(`發票號碼 ${normalized} 已登記過，請確認`);
      } else {
        const message = errText(err, "存檔失敗，請稍後再試");
        setError(message);
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";
  const labelCls = "text-xs font-medium text-muted-foreground";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[94vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="sales-invoice-dialog-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {invoice?.status === "voided"
                  ? "檢視發票（已作廢）"
                  : readOnly
                    ? "檢視銷項發票"
                    : isEdit
                      ? "檢視／編輯銷項發票"
                      : order
                        ? `開立發票：訂單 ${order.order_number}`
                        : "開立發票"}
              </Dialog.Title>
              <p id="sales-invoice-dialog-desc" className="mt-1 text-sm text-muted-foreground">
                {readOnly
                  ? "唯讀檢視；如需修改請從列表按編輯（鉛筆）進入"
                  : isEdit
                    ? "調整發票內容後儲存；已作廢發票僅供檢視"
                    : "號碼留空＝由光賀自動配號開立電子發票；已有紙本手開號碼可直接填入登記"}
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

          {loadingPrefill && <p className="mt-3 text-sm text-muted-foreground">載入訂單資料中…</p>}

          <fieldset disabled={readOnly || saving} className="mt-4 space-y-4">
            {/* 類型與號碼 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <label className={labelCls} htmlFor="si-type">發票類型</label>
                <select
                  id="si-type"
                  value={invoiceType}
                  onChange={(e) => setInvoiceType(e.target.value as SalesInvoiceType)}
                  className={inputCls}
                >
                  <option value="B2B">B2B（買方統編）</option>
                  <option value="B2C">B2C（一般消費者）</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelCls} htmlFor="si-number">發票號碼</label>
                <input
                  id="si-number"
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="留空＝光賀自動配號"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className={labelCls} htmlFor="si-date">發票日期</label>
                <input
                  id="si-date"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className={labelCls} htmlFor="si-tax-type">課稅別</label>
                <select
                  id="si-tax-type"
                  value={taxType}
                  onChange={(e) => setTaxType(Number(e.target.value))}
                  className={inputCls}
                >
                  {TAX_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {duplicateOf && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                此號碼已登記過（{duplicateOf}），儲存前請確認。
              </p>
            )}

            {/* 買方 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {invoiceType === "B2B" && (
                <div className="space-y-1">
                  <label className={labelCls} htmlFor="si-buyer-tax-id">買方統編（必填）</label>
                  <input
                    id="si-buyer-tax-id"
                    type="text"
                    inputMode="numeric"
                    maxLength={8}
                    value={buyerTaxId}
                    onChange={(e) => {
                      const ban = e.target.value.replace(/\D/g, "");
                      setBuyerTaxId(ban);
                      // 打滿 8 碼即查光賀帶出公司抬頭（抬頭已有值則不覆蓋）
                      if (/^\d{8}$/.test(ban)) {
                        void amegoBanQuery(ban).then((r) => {
                          if (r.ok && r.name) setBuyerName((prev) => (prev.trim() ? prev : r.name));
                        });
                      }
                    }}
                    className={inputCls}
                  />
                </div>
              )}
              <div className="col-span-2 space-y-1">
                <label className={labelCls} htmlFor="si-buyer-name">
                  買方抬頭{invoiceType === "B2B" ? "（必填，輸入統編自動帶出）" : "（選填）"}
                </label>
                <input
                  id="si-buyer-name"
                  type="text"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className={invoiceType === "B2B" ? "space-y-1" : "col-span-2 space-y-1"}>
                <label className={labelCls} htmlFor="si-buyer-email">寄送 Email</label>
                <input
                  id="si-buyer-email"
                  type="email"
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            {/* B2C 載具／捐贈／紙本 */}
            {invoiceType === "B2C" && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <label className={labelCls} htmlFor="si-carrier-type">載具類別</label>
                  <select
                    id="si-carrier-type"
                    value={carrierType}
                    onChange={(e) => setCarrierType(e.target.value)}
                    className={inputCls}
                  >
                    {CARRIER_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelCls} htmlFor="si-carrier-id">載具號碼</label>
                  <input
                    id="si-carrier-id"
                    type="text"
                    value={carrierId}
                    onChange={(e) => setCarrierId(e.target.value)}
                    placeholder="/ABC1234"
                    disabled={!carrierType}
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelCls} htmlFor="si-donation">捐贈碼</label>
                  <input
                    id="si-donation"
                    type="text"
                    value={donationCode}
                    onChange={(e) => setDonationCode(e.target.value)}
                    placeholder="留空＝不捐贈"
                    className={inputCls}
                  />
                </div>
                <label className="flex items-end gap-2 pb-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={printFlag}
                    onChange={(e) => setPrintFlag(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  印製紙本
                </label>
              </div>
            )}

            {/* 品項明細 */}
            <div className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <p className="text-sm font-medium text-foreground">
                  品項明細
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {invoiceType === "B2B" ? "單價請填未稅" : "單價請填含稅"}
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {orderPrefill && orderPrefill.depositAmount > 0 && (
                    <Button type="button" variant="outline" className="h-7 px-2 text-xs" onClick={useDepositLine}>
                      改開訂金 ${orderPrefill.depositAmount.toLocaleString()}
                    </Button>
                  )}
                  {balanceAmount > 0 && (
                    <Button type="button" variant="outline" className="h-7 px-2 text-xs" onClick={useBalanceLine}>
                      改開尾款 ${balanceAmount.toLocaleString()}
                    </Button>
                  )}
                  {orderPrefill && orderPrefill.lines.length > 0 && (
                    <Button type="button" variant="outline" className="h-7 px-2 text-xs" onClick={useOrderLines}>
                      帶入全部品項
                    </Button>
                  )}
                  {invoiceType === "B2B" && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      title="把目前的含稅單價全部 ÷1.05 轉為未稅"
                      onClick={convertLinesToExTax}
                    >
                      含稅單價轉未稅
                    </Button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-border">
                {lines.map((l) => (
                  <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_4.5rem_6rem_6rem_2rem] items-center gap-2 px-3 py-1.5">
                    <input
                      type="text"
                      value={l.description}
                      onChange={(e) => updateLine(l.key, { description: e.target.value })}
                      placeholder="品名"
                      aria-label="品名"
                      className={inputCls}
                    />
                    <input
                      type="number"
                      value={l.quantity}
                      onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                      aria-label="數量"
                      className={`${inputCls} text-right`}
                    />
                    <input
                      type="number"
                      value={l.unitPrice}
                      onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                      placeholder="單價"
                      aria-label="單價"
                      className={`${inputCls} text-right`}
                    />
                    <span className="text-right text-sm tabular-nums text-foreground">
                      {lineAmount(l).toLocaleString()}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="刪除此列"
                      onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== l.key) : prev))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-border px-3 py-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => setLines((prev) => [...prev, emptyLine()])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  新增一列
                </Button>
                <div className="text-right text-sm tabular-nums">
                  <span className="text-muted-foreground">
                    未稅 ${totals.amount_ex_tax.toLocaleString()}｜稅額 ${totals.tax_amount.toLocaleString()}｜
                  </span>
                  <span className="font-semibold text-foreground">含稅 ${totals.amount_inc_tax.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className={labelCls} htmlFor="si-notes">備註</label>
              <textarea
                id="si-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
            </div>
          </fieldset>

          {invoice?.status === "voided" && (
            <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              此發票已於 {invoice.void_date ?? "—"} 作廢{invoice.void_reason ? `：${invoice.void_reason}` : ""}
            </p>
          )}

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          {!readOnly && (
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" className="h-8 px-3 text-sm">取消</Button>
              </Dialog.Close>
              {(!isEdit || invoice?.status === "draft") && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-sm"
                  disabled={saving}
                  onClick={() => void save(false)}
                >
                  儲存草稿
                </Button>
              )}
              <Button
                type="button"
                className="h-8 px-3 text-sm"
                disabled={saving}
                onClick={() => void save(invoice?.status !== "issued")}
              >
                {saving
                  ? "處理中…"
                  : invoice?.status === "issued"
                    ? "儲存修改"
                    : invoiceNumber.trim()
                      ? "登記手開發票"
                      : "光賀開立發票"}
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
