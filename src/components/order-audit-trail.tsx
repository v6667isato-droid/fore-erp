"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, History, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuditActorNames } from "@/lib/use-audit-actor-names";
import {
  buildOrderTrail,
  collectReferenceIds,
  formatAuditTime,
  type AuditRow,
  type EntryTone,
  type TrailEvent,
  type TrailLookups,
} from "@/lib/order-audit-trail";

const TONE_CLASS: Record<EntryTone, string> = {
  create: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  update: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  delete: "bg-red-500/15 text-red-600 dark:text-red-400",
};

const RAW_TABLE_LABELS: Record<string, string> = {
  orders: "訂單",
  order_items: "品項",
  work_orders: "工單",
  order_returns: "退貨單",
  order_return_items: "退貨品項",
};

const RAW_ACTION_LABELS: Record<string, string> = {
  INSERT: "新增",
  UPDATE: "修改",
  DELETE: "刪除",
};

const EMPTY_LOOKUPS: TrailLookups = { variants: {}, employees: {}, customers: {} };

async function fetchLookups(rows: AuditRow[]): Promise<TrailLookups> {
  const { variantIds, employeeIds, customerIds } = collectReferenceIds(rows);
  const [vRes, eRes, cRes] = await Promise.all([
    variantIds.length
      ? supabase
          .from("product_variants")
          .select("id, product_code, spec1, product_series(series_name)")
          .in("id", variantIds)
      : Promise.resolve({ data: [] }),
    employeeIds.length
      ? supabase.from("employees").select("id, name").in("id", employeeIds)
      : Promise.resolve({ data: [] }),
    customerIds.length
      ? supabase.from("customers").select("id, name, alias").in("id", customerIds)
      : Promise.resolve({ data: [] }),
  ]);

  const variants: Record<string, string> = {};
  for (const v of (vRes.data ?? []) as {
    id: string;
    product_code: string | null;
    spec1: string | null;
    product_series: { series_name: string | null } | null;
  }[]) {
    const series = v.product_series?.series_name?.trim() ?? "";
    const spec = v.spec1?.trim() ?? "";
    const code = v.product_code?.trim() ?? "";
    const name = [series, spec].filter(Boolean).join(" ");
    variants[v.id] = name ? (code ? `${name}（${code}）` : name) : code || v.id.slice(0, 8);
  }
  const employees: Record<string, string> = {};
  for (const e of (eRes.data ?? []) as { id: string; name: string | null }[]) {
    if (e.name?.trim()) employees[e.id] = e.name.trim();
  }
  const customers: Record<string, string> = {};
  for (const c of (cRes.data ?? []) as { id: string; name: string | null; alias: string | null }[]) {
    const name = c.name?.trim() ?? "";
    const alias = c.alias?.trim() ?? "";
    if (name) customers[c.id] = alias ? `${name}（${alias}）` : name;
  }
  return { variants, employees, customers };
}

/** 單一訂單的修改歷程時間軸（新到舊） */
export function OrderAuditTrail({ orderId }: { orderId: string }) {
  const { actorText } = useAuditActorNames();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [lookups, setLookups] = useState<TrailLookups>(EMPTY_LOOKUPS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("order_audit_trail", { p_order_id: orderId });
      if (cancelled) return;
      if (error) {
        toast.error(`載入訂單歷程失敗：${error.message}`);
        setRows([]);
        setLoading(false);
        return;
      }
      const fetched = (data ?? []) as unknown as AuditRow[];
      const lk = await fetchLookups(fetched);
      if (cancelled) return;
      setRows(fetched);
      setLookups(lk);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const events = useMemo(() => buildOrderTrail(rows, lookups), [rows, lookups]);

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">載入訂單歷程中…</p>;
  }
  return <OrderTrailTimeline events={events} actorText={actorText} />;
}

export function OrderTrailTimeline({
  events,
  actorText,
}: {
  events: TrailEvent[];
  actorText: (email: string | null, label: string | null) => string;
}) {
  const [rawOpen, setRawOpen] = useState<Set<string>>(new Set());

  function toggleRaw(key: string) {
    setRawOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        沒有修改紀錄（操作紀錄自 2026/8/6 起開始記錄）
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {events.map((ev) => (
        <li key={ev.key} className="rounded-xl border border-border bg-card p-3 sm:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatAuditTime(ev.at)}
              </span>
              <span
                className="break-all text-sm font-medium text-foreground"
                title={ev.actorEmail ?? ev.actorLabel ?? undefined}
              >
                {actorText(ev.actorEmail, ev.actorLabel)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => toggleRaw(ev.key)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              {rawOpen.has(ev.key) ? "收合原始紀錄" : `原始紀錄（${ev.rows.length}）`}
            </button>
          </div>

          <div className="mt-2 flex flex-col gap-3">
            {ev.entries.map((entry, i) => (
              <div key={i}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[entry.tone]}`}
                  >
                    {entry.title}
                  </span>
                  {entry.subject ? (
                    <span className="min-w-0 break-words text-sm text-foreground">{entry.subject}</span>
                  ) : null}
                </div>
                {entry.changes.length > 0 ? (
                  <dl className="mt-1.5 flex flex-col gap-1 pl-1 text-xs">
                    {entry.changes.map((c, j) => (
                      <div key={j} className="flex flex-wrap items-baseline gap-x-2">
                        <dt className="shrink-0 text-muted-foreground">{c.label}</dt>
                        <dd className="min-w-0 break-words">
                          {c.from !== undefined ? (
                            <>
                              <span className="text-muted-foreground line-through">{c.from}</span>
                              <span className="mx-1 text-muted-foreground">→</span>
                              <span className="font-medium text-foreground">{c.to}</span>
                            </>
                          ) : (
                            <span className="text-foreground">{c.to}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {entry.notes.map((n, j) => (
                  <p key={j} className="mt-1 pl-1 text-[11px] text-muted-foreground">
                    └ {n}
                  </p>
                ))}
              </div>
            ))}
          </div>

          {rawOpen.has(ev.key) ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-2">
              {ev.rows.map((r) => (
                <div key={r.id} className="text-[11px]">
                  <div className="text-muted-foreground">
                    {formatAuditTime(r.happened_at)} · {RAW_TABLE_LABELS[r.table_name] ?? r.table_name}
                    {RAW_ACTION_LABELS[r.action] ?? r.action} ·{" "}
                    <span className="font-mono">{r.record_id ?? "—"}</span>
                  </div>
                  <pre className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-2 font-mono">
                    {JSON.stringify(r.action === "DELETE" ? r.old_data : r.action === "INSERT" ? r.new_data : { 前: r.old_data, 後: r.new_data }, null, 1)}
                  </pre>
                </div>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

interface OrderHit {
  id: string;
  order_number: string | null;
  order_date: string | null;
  status: string | null;
  shipping_contact_name: string | null;
  deleted_at: string | null;
  customers: { name: string | null; alias: string | null } | null;
}

const ORDER_HIT_SELECT =
  "id, order_number, order_date, status, shipping_contact_name, deleted_at, customers(name, alias)";

function customerText(hit: OrderHit): string {
  const name = hit.customers?.name?.trim() ?? "";
  const alias = hit.customers?.alias?.trim() ?? "";
  return name ? (alias ? `${name}（${alias}）` : name) : "—";
}

/** 操作紀錄頁的「訂單歷程」：以訂單編號／客戶名稱／收件人搜尋後檢視歷程 */
export function OrderAuditTrailSearch() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<OrderHit[] | null>(null);
  const [selected, setSelected] = useState<OrderHit | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    // PostgREST or() 以逗號與括號分隔條件，關鍵字內不能出現
    const q = query.replace(/[,()]/g, " ").trim();
    if (!q) return;
    setSearching(true);
    setSelected(null);

    const { data: custs } = await supabase
      .from("customers")
      .select("id")
      .or(`name.ilike.%${q}%,alias.ilike.%${q}%`)
      .limit(50);
    const custIds = (custs ?? []).map((c) => c.id);

    const [direct, byCustomer] = await Promise.all([
      supabase
        .from("orders")
        .select(ORDER_HIT_SELECT)
        .or(`order_number.ilike.%${q}%,shipping_contact_name.ilike.%${q}%`)
        .order("order_date", { ascending: false })
        .limit(50),
      custIds.length
        ? supabase
            .from("orders")
            .select(ORDER_HIT_SELECT)
            .in("customer_id", custIds)
            .order("order_date", { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [], error: null }),
    ]);
    setSearching(false);
    if (direct.error || byCustomer.error) {
      toast.error(`搜尋訂單失敗：${(direct.error ?? byCustomer.error)?.message}`);
      return;
    }
    const byId = new Map<string, OrderHit>();
    for (const h of [...(direct.data ?? []), ...(byCustomer.data ?? [])] as unknown as OrderHit[]) {
      byId.set(h.id, h);
    }
    setHits(
      [...byId.values()].sort((a, b) => (b.order_date ?? "").localeCompare(a.order_date ?? "")),
    );
  }

  if (selected) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9 px-3 text-xs"
            onClick={() => setSelected(null)}
          >
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            搜尋結果
          </Button>
          <div className="min-w-0 text-sm">
            <span className="font-medium text-foreground">{selected.order_number ?? "—"}</span>
            <span className="ml-2 text-muted-foreground">
              {customerText(selected)}
              {selected.shipping_contact_name?.trim() ? `／${selected.shipping_contact_name.trim()}` : ""}
            </span>
          </div>
        </div>
        <OrderAuditTrail orderId={selected.id} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={search} className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="訂單編號、客戶名稱或收件人"
          className="h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button type="submit" className="h-9 px-3 text-xs" disabled={searching || !query.trim()}>
          <Search className="mr-1 h-3.5 w-3.5" />
          {searching ? "搜尋中…" : "搜尋"}
        </Button>
      </form>

      {hits === null ? (
        <p className="text-xs text-muted-foreground">
          搜尋訂單後可檢視該訂單、品項、工單與退貨的完整修改歷程。
        </p>
      ) : hits.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          找不到符合的訂單
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => setSelected(h)}
                className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-3 py-2.5 text-left hover:bg-accent/40"
              >
                <span className="font-mono text-sm font-medium text-foreground">
                  {h.order_number ?? "—"}
                </span>
                <span className="min-w-0 text-sm text-foreground">
                  {customerText(h)}
                  {h.shipping_contact_name?.trim() ? (
                    <span className="text-muted-foreground">／{h.shipping_contact_name.trim()}</span>
                  ) : null}
                </span>
                <span className="ml-auto flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">{h.order_date?.replace(/-/g, "/") ?? "—"}</span>
                  <span>{h.status ?? ""}</span>
                  {h.deleted_at ? <span className="text-red-600 dark:text-red-400">已刪除</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 訂單列表上的「修改紀錄」視窗 */
export function OrderAuditTrailDialog({
  order,
  open,
  onOpenChange,
}: {
  order: { id: string; order_number: string | null; customer_name?: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-background shadow-lg focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-foreground">
                <History className="h-4 w-4 shrink-0" />
                修改紀錄
              </Dialog.Title>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {order?.order_number ?? ""}
                {order?.customer_name ? ` · ${order.customer_name}` : ""}
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-accent/40"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto p-3 sm:p-4">
            {order ? <OrderAuditTrail orderId={order.id} /> : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
