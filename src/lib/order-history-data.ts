import { supabase } from "@/lib/supabase";
import { fetchOrderAttachments, type OrderAttachment } from "@/lib/order-attachments";
import type { OrderHistoryInput } from "@/lib/order-history";
import { normalizeWorkOrderStage, type WorkOrderStage } from "@/lib/work-order-stages";

export interface OrderHistoryItem {
  id: string;
  label: string;
  stage: WorkOrderStage | null;
}

export interface OrderHistorySummary {
  status: string | null;
  order_date: string | null;
  expected_delivery_date: string | null;
}

export interface OrderHistoryData {
  summary: OrderHistorySummary;
  items: OrderHistoryItem[];
  attachments: OrderAttachment[];
  input: OrderHistoryInput;
  /** auth user id → 顯示名稱 */
  userNames: Record<string, string>;
  /** employees.id → 姓名 */
  employeeNames: Record<string, string>;
}

type ItemQueryRow = {
  id: string;
  quantity: number | null;
  custom_name: string | null;
  custom_category: string | null;
  product_variants: {
    product_code: string | null;
    spec1: string | null;
    product_series: { series_name: string | null } | null;
  } | null;
  work_orders: { id: string; stage: string | null }[] | { id: string; stage: string | null } | null;
};

function itemLabel(row: ItemQueryRow): string {
  const pv = row.product_variants;
  const variantName = [pv?.product_series?.series_name?.trim(), pv?.spec1?.trim()].filter(Boolean).join(" ");
  const code = pv?.product_code?.trim();
  const name =
    variantName || row.custom_name?.trim() || row.custom_category?.trim() || code || "品項";
  const withCode = code && variantName ? `${name}（${code}）` : name;
  return row.quantity != null ? `${withCode} × ${row.quantity}` : withCode;
}

function asArray<T>(v: T[] | T | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}：${res.error.message}`);
  return res.data as T;
}

/** 一次載入訂單履歷需要的資料（時間軸＋完工照片） */
export async function loadOrderHistoryData(orderId: string): Promise<OrderHistoryData> {
  const [orderRes, itemsRes, statusRes, returnsRes, invoicesRes, attachments] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "status, order_date, expected_delivery_date, created_at, deposit_amount, deposit_date, final_payment_amount, final_payment_date, shipped_date",
      )
      .eq("id", orderId)
      .single(),
    supabase
      .from("order_items")
      .select(
        "id, quantity, custom_name, custom_category, product_variants (product_code, spec1, product_series (series_name)), work_orders (id, stage)",
      )
      .eq("order_id", orderId)
      .order("line_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("order_status_history")
      .select("old_status, new_status, changed_at, changed_by_user_id, actor_label")
      .eq("order_id", orderId)
      .order("changed_at", { ascending: true }),
    supabase.from("order_returns").select("id, return_date, refund_amount, reason").eq("order_id", orderId),
    supabase
      .from("sales_invoice_orders")
      .select("sales_invoices!inner (id, invoice_number, invoice_date, status, amount_inc_tax, void_date, deleted_at)")
      .eq("order_id", orderId)
      .is("sales_invoices.deleted_at", null),
    fetchOrderAttachments(orderId),
  ]);

  const order = must(orderRes, "讀取訂單失敗");
  const itemRows = (must(itemsRes, "讀取品項失敗") ?? []) as unknown as ItemQueryRow[];
  const statusHistory = must(statusRes, "讀取狀態紀錄失敗") ?? [];
  const returns = must(returnsRes, "讀取退貨紀錄失敗") ?? [];
  const invoiceLinks = (must(invoicesRes, "讀取發票失敗") ?? []) as unknown as {
    sales_invoices: OrderHistoryInput["invoices"][number];
  }[];

  const items: OrderHistoryItem[] = itemRows.map((r) => {
    const wo = asArray(r.work_orders)[0];
    return { id: r.id, label: itemLabel(r), stage: wo ? normalizeWorkOrderStage(wo.stage) : null };
  });
  const workOrders = itemRows.flatMap((r) =>
    asArray(r.work_orders).map((w) => ({ id: w.id, order_item_id: r.id })),
  );

  let stageHistory: OrderHistoryInput["stageHistory"] = [];
  if (workOrders.length > 0) {
    stageHistory =
      must(
        await supabase
          .from("work_order_stage_history")
          .select("work_order_id, old_stage, new_stage, changed_at, changed_by_user_id, changed_by_employee_id")
          .in(
            "work_order_id",
            workOrders.map((w) => w.id),
          ),
        "讀取工序紀錄失敗",
      ) ?? [];
  }

  // 操作者名稱：user_profiles（姓名／Email）＋ employees
  const userIds = new Set<string>();
  const employeeIds = new Set<string>();
  for (const r of statusHistory) if (r.changed_by_user_id) userIds.add(r.changed_by_user_id);
  for (const r of stageHistory) {
    if (r.changed_by_user_id) userIds.add(r.changed_by_user_id);
    if (r.changed_by_employee_id) employeeIds.add(r.changed_by_employee_id);
  }
  for (const a of attachments) if (a.uploaded_by) userIds.add(a.uploaded_by);

  const profiles = userIds.size
    ? (must(
        await supabase
          .from("user_profiles")
          .select("user_id, full_name, email, employee_id")
          .in("user_id", [...userIds]),
        "讀取使用者失敗",
      ) ?? [])
    : [];
  for (const p of profiles) if (p.employee_id) employeeIds.add(p.employee_id);
  const employees = employeeIds.size
    ? (must(
        await supabase.from("employees").select("id, name").in("id", [...employeeIds]),
        "讀取員工失敗",
      ) ?? [])
    : [];

  const employeeNames: Record<string, string> = {};
  for (const e of employees) if (e.name?.trim()) employeeNames[e.id] = e.name.trim();
  const userNames: Record<string, string> = {};
  for (const p of profiles) {
    userNames[p.user_id] =
      (p.employee_id ? employeeNames[p.employee_id] : undefined) ??
      (p.full_name?.trim() || p.email.split("@")[0]);
  }

  return {
    summary: {
      status: order.status,
      order_date: order.order_date,
      expected_delivery_date: order.expected_delivery_date,
    },
    items,
    attachments,
    userNames,
    employeeNames,
    input: {
      order: {
        created_at: order.created_at,
        deposit_amount: order.deposit_amount,
        deposit_date: order.deposit_date,
        final_payment_amount: order.final_payment_amount,
        final_payment_date: order.final_payment_date,
        shipped_date: order.shipped_date,
      },
      items: items.map(({ id, label }) => ({ id, label })),
      workOrders,
      stageHistory,
      statusHistory,
      photos: attachments.map((a) => ({
        id: a.id,
        order_item_id: a.order_item_id,
        taken_on: a.taken_on,
        created_at: a.created_at,
        uploaded_by: a.uploaded_by,
      })),
      returns,
      invoices: invoiceLinks.map((l) => l.sales_invoices),
    },
  };
}
