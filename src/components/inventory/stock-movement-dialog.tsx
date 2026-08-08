"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import {
  STOCK_MOVEMENT_TYPES,
  type EmployeeOption,
  type PartVariantStockRow,
  type StockMovementRow,
  type StockMovementType,
} from "@/types/inventory";

export interface StockMovementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 異動對象＝庫存變體（part_variant_stock_status 一列） */
  variant: PartVariantStockRow | null;
  onSaved: () => void;
}

/** 該筆異動對應的訂單摘要（聯絡人＋品項＋數量），用於「最近異動」右側顯示 */
interface MovementOrderRef {
  contact: string;
  items: string;
}

function firstRel(rel: unknown): Record<string, unknown> | null {
  const one = Array.isArray(rel) ? rel[0] : rel;
  return one && typeof one === "object" ? (one as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 聯絡人：訂單收貨聯絡人 → 客戶主檔聯絡人 → 客戶簡稱／全名 → 訂單編號（與行事曆一致） */
function contactOfOrder(order: Record<string, unknown> | null): string {
  if (!order) return "—";
  const customer = firstRel(order.customers);
  return (
    str(order.shipping_contact_name) ||
    str(customer?.contact_person) ||
    str(customer?.alias) ||
    str(customer?.name) ||
    str(order.order_number) ||
    "—"
  );
}

/** 品項名稱：自訂名稱優先，否則用變體料號（與生產管理一致） */
function itemLabel(item: Record<string, unknown> | null): string {
  if (!item) return "";
  const variant = firstRel(item.product_variants);
  const name = str(item.custom_name) || str(variant?.product_code) || "品項";
  const qty = Number(item.quantity ?? 0) || 0;
  return `${name} ×${qty}`;
}

function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 手動登錄庫存異動（進料／零星領用／盤點調整），並顯示該變體最近異動 */
export function StockMovementDialog({ open, onOpenChange, variant, onSaved }: StockMovementDialogProps) {
  const [movementType, setMovementType] = useState<StockMovementType>("進料");
  const [quantity, setQuantity] = useState("");
  const [movementDate, setMovementDate] = useState(todayISO());
  const [employeeId, setEmployeeId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [recent, setRecent] = useState<StockMovementRow[]>([]);
  /** key = stock_movements.id */
  const [orderRefs, setOrderRefs] = useState<Record<string, MovementOrderRef>>({});

  useEffect(() => {
    if (!open) return;
    setMovementType("進料");
    setQuantity("");
    setMovementDate(todayISO());
    setEmployeeId("");
    setNotes("");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    supabase
      .from("employees")
      .select("id, name")
      .is("deleted_at", null)
      .or("employment_status.is.null,employment_status.eq.true")
      .order("name")
      .then(({ data }) => {
        if (!cancelled) setEmployees((data as EmployeeOption[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !variant) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("stock_movements")
        .select(
          "id, part_id, movement_type, quantity, movement_date, employee_id, notes, created_at, order_id, work_order_id",
        )
        .eq("part_variant_id", variant.id)
        .order("created_at", { ascending: false })
        .limit(8);
      if (cancelled) return;
      const rows = (data as StockMovementRow[]) ?? [];
      setRecent(rows);
      setOrderRefs({});

      // 工單扣帳可定位到單一 order_item；僅有 order_id 的（如出貨對帳）退回列出訂單全部品項
      const workOrderIds = [...new Set(rows.map((r) => r.work_order_id).filter((v): v is string => !!v))];
      const orderOnlyIds = [
        ...new Set(
          rows.filter((r) => !r.work_order_id).map((r) => r.order_id).filter((v): v is string => !!v),
        ),
      ];
      if (workOrderIds.length === 0 && orderOnlyIds.length === 0) return;

      const [woRes, orderRes] = await Promise.all([
        workOrderIds.length > 0
          ? supabase
              .from("work_orders")
              .select(
                "id, order_items(quantity, custom_name, product_variants(product_code), " +
                  "orders(order_number, shipping_contact_name, customers(name, alias, contact_person)))",
              )
              .in("id", workOrderIds)
          : Promise.resolve({ data: [] }),
        orderOnlyIds.length > 0
          ? supabase
              .from("orders")
              .select(
                "id, order_number, shipping_contact_name, customers(name, alias, contact_person), " +
                  "order_items(quantity, custom_name, product_variants(product_code))",
              )
              .in("id", orderOnlyIds)
          : Promise.resolve({ data: [] }),
      ]);
      if (cancelled) return;

      const byWorkOrder = new Map<string, MovementOrderRef>();
      for (const raw of (woRes.data as unknown[]) ?? []) {
        const wo = firstRel(raw);
        if (!wo) continue;
        const item = firstRel(wo.order_items);
        byWorkOrder.set(String(wo.id), {
          contact: contactOfOrder(firstRel(item?.orders)),
          items: itemLabel(item),
        });
      }
      const byOrder = new Map<string, MovementOrderRef>();
      for (const raw of (orderRes.data as unknown[]) ?? []) {
        const order = firstRel(raw);
        if (!order) continue;
        const items = Array.isArray(order.order_items) ? order.order_items : [];
        byOrder.set(String(order.id), {
          contact: contactOfOrder(order),
          items: items.map((it) => itemLabel(firstRel(it))).filter(Boolean).join("、"),
        });
      }

      const next: Record<string, MovementOrderRef> = {};
      for (const r of rows) {
        const ref =
          (r.work_order_id ? byWorkOrder.get(r.work_order_id) : undefined) ??
          (r.order_id ? byOrder.get(r.order_id) : undefined);
        if (ref) next[r.id] = ref;
      }
      setOrderRefs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, variant]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!variant) return;
    setError(null);
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty === 0) {
      setError("請輸入非 0 的數量");
      return;
    }
    // 進料存正數、領用存負數；盤點調整依輸入正負
    let signed = qty;
    if (movementType === "進料") signed = Math.abs(qty);
    if (movementType === "領用") signed = -Math.abs(qty);
    setSaving(true);
    const { error: err } = await supabase.from("stock_movements").insert({
      part_id: variant.part_id,
      part_variant_id: variant.id,
      movement_type: movementType,
      quantity: signed,
      movement_date: movementDate,
      employee_id: employeeId || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (err) {
      setError(err.message || "登錄失敗");
      toast.error(err.message || "登錄失敗");
      return;
    }
    toast.success("已登錄庫存異動");
    onSaved();
    onOpenChange(false);
  }

  const inputCls =
    "h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="stock-movement-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">庫存異動</Dialog.Title>
              <p id="stock-movement-desc" className="mt-1 text-sm text-muted-foreground">
                {variant ? (
                  <>
                    {variant.sku}｜{variant.name}
                    {variant.material_name ? `・${variant.material_name}` : ""}
                    （目前庫存 {variant.current_stock} {variant.unit}）
                  </>
                ) : (
                  ""
                )}
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
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sm-type" className="text-xs text-muted-foreground">異動類型</label>
                <select
                  id="sm-type"
                  value={movementType}
                  onChange={(e) => setMovementType(e.target.value as StockMovementType)}
                  className={inputCls}
                >
                  {STOCK_MOVEMENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sm-qty" className="text-xs text-muted-foreground">數量</label>
                <input
                  id="sm-qty"
                  type="number"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={inputCls}
                  placeholder={movementType === "盤點調整" ? "可輸入正負" : "輸入正數即可"}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sm-date" className="text-xs text-muted-foreground">日期</label>
                <input id="sm-date" type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} className={inputCls} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sm-employee" className="text-xs text-muted-foreground">經手人</label>
                <select id="sm-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls}>
                  <option value="">（未指定）</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              進料會記為加項、領用記為減項；盤點調整請直接輸入正（盤盈）或負（盤虧）數量。
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sm-notes" className="text-xs text-muted-foreground">備註</label>
              <input id="sm-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="選填，例如進貨單號" />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={saving}>取消</Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>{saving ? "登錄中…" : "登錄異動"}</Button>
            </div>
          </form>

          {recent.length > 0 && (
            <div className="mt-5 border-t border-border pt-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">最近異動</p>
              <ul className="space-y-1">
                {recent.map((m) => {
                  const ref = orderRefs[m.id];
                  const detail = ref
                    ? [ref.contact, ref.items].filter(Boolean).join("｜")
                    : m.notes || "";
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="shrink-0">{formatDate(m.movement_date)}</span>
                      <span className="shrink-0">{m.movement_type}</span>
                      <span className={m.quantity > 0 ? "font-medium text-emerald-600 dark:text-emerald-400" : "font-medium text-destructive"}>
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-right" title={detail}>
                        {detail}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
