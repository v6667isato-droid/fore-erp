"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollText, ChevronDown, ChevronRight, RotateCw } from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE = 50;

/** 資料表中文名；未列出的表直接顯示原名 */
const TABLE_LABELS: Record<string, string> = {
  orders: "訂單",
  order_items: "訂單品項",
  order_returns: "退貨單",
  order_return_items: "退貨品項",
  work_orders: "工單",
  customers: "客戶",
  channels: "通路",
  product_series: "產品系列",
  product_variants: "產品規格",
  product_variant_channel_prices: "通路售價",
  product_series_channel_discounts: "通路折扣",
  variant_channel_price_overrides: "通路售價覆寫",
  option_types: "產品選項類型",
  option_values: "產品選項值",
  product_options: "產品選項掛載",
  purchase_orders: "採購單",
  purchases: "採購品項",
  vendors: "廠商",
  procurement_materials: "採購物料",
  parts: "零件",
  part_variants: "零件變體",
  bom_lines: "BOM",
  stock_movements: "庫存異動",
  sales_invoices: "銷項發票",
  sales_invoice_items: "銷項發票明細",
  sales_allowances: "銷貨折讓",
  accounting_invoices: "進項發票",
  employees: "員工",
  payslips: "薪資單",
  leave_requests: "請假單",
  overtime_records: "加班紀錄",
  overtime_requests: "加班申報",
  annual_leave_grants: "特休授予",
  channel_statements: "通路對帳單",
  channel_statement_lines: "對帳單明細",
  app_settings: "系統參數",
  company_settings: "公司稅籍設定",
};

const ACTION_LABELS: Record<string, { label: string; className: string }> = {
  INSERT: { label: "新增", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  UPDATE: { label: "修改", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  DELETE: { label: "刪除", className: "bg-red-500/15 text-red-600 dark:text-red-400" },
};

/** 從快照裡挑一個可讀的欄位當摘要（訂單號、品名等） */
const SUMMARY_KEYS = [
  "order_number",
  "invoice_number",
  "statement_no",
  "part_no",
  "name",
  "title",
  "customer_name",
  "vendor_name",
  "description",
  "item_name",
  "key",
];

interface AuditRow {
  id: number;
  happened_at: string;
  table_name: string;
  action: string;
  record_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  actor_label: string | null;
  changed_fields: string[] | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

/** 操作者下拉選項；value 形如 `email:someone@x.com` 或 `label:telegram-bot` */
type ActorOption = { value: string; label: string };

/** service role 寫入來源標記（audit_logs.actor_label）轉可讀文字 */
function describeActorLabel(
  label: string,
  channelNames: Record<string, string>,
): string {
  const l = label.trim();
  if (l.startsWith("portal:")) {
    const chName = channelNames[l.slice("portal:".length)];
    return chName ? `通路下單（${chName}）` : "通路下單";
  }
  if (l.startsWith("cron:")) return `排程（${l.slice("cron:".length)}）`;
  if (l.startsWith("user:")) return l.slice("user:".length);
  if (l === "telegram-bot") return "Telegram Bot";
  if (l) return l;
  return "系統";
}

function formatTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v === "" ? "（空白）" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function truncate(s: string, max = 120): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function summaryOf(row: AuditRow): string {
  const data = row.new_data ?? row.old_data;
  if (!data) return row.record_id ? row.record_id.slice(0, 8) : "—";
  for (const k of SUMMARY_KEYS) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return truncate(v.trim(), 40);
  }
  return row.record_id ? row.record_id.slice(0, 8) : "—";
}

export function AuditLogsPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [channelNames, setChannelNames] = useState<Record<string, string>>({});
  /** email（小寫）→ 顯示名稱：員工姓名優先，其次 user_profiles.full_name */
  const [nameByEmail, setNameByEmail] = useState<Record<string, string>>({});
  /** 操作者下拉選項：value 為 `email:<email>` 或 `label:<actor_label>` */
  const [actorOptions, setActorOptions] = useState<ActorOption[]>([]);

  const [filterTable, setFilterTable] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterActor, setFilterActor] = useState("");
  const [filterRecord, setFilterRecord] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const fetchLogs = useCallback(
    async (append: boolean, beforeId?: number) => {
      let query = supabase
        .from("audit_logs")
        .select(
          "id, happened_at, table_name, action, record_id, actor_id, actor_email, actor_label, changed_fields, old_data, new_data",
        )
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (beforeId) query = query.lt("id", beforeId);
      if (filterTable) query = query.eq("table_name", filterTable);
      if (filterAction) query = query.eq("action", filterAction);
      if (filterActor.startsWith("email:")) {
        query = query.eq("actor_email", filterActor.slice("email:".length));
      } else if (filterActor.startsWith("label:")) {
        query = query.eq("actor_label", filterActor.slice("label:".length));
      }
      if (filterRecord.trim()) query = query.ilike("record_id", `${filterRecord.trim()}%`);
      if (filterFrom) query = query.gte("happened_at", `${filterFrom}T00:00:00`);
      if (filterTo) query = query.lte("happened_at", `${filterTo}T23:59:59`);

      const { data, error } = await query;
      if (error) {
        toast.error(`載入操作紀錄失敗：${error.message}`);
        return;
      }
      const mapped = (data ?? []) as unknown as AuditRow[];
      setRows((prev) => (append ? [...prev, ...mapped] : mapped));
      setHasMore(mapped.length === PAGE_SIZE);
    },
    [filterTable, filterAction, filterActor, filterRecord, filterFrom, filterTo],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await fetchLogs(false);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchLogs]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("channels").select("id, name");
      if (data) {
        const map: Record<string, string> = {};
        for (const c of data) map[String(c.id)] = String(c.name ?? "");
        setChannelNames(map);
      }
    })();
  }, []);

  /** email → 姓名對照，並組出操作者下拉選項（人員來自 employees／user_profiles，來源標記自紀錄取樣） */
  useEffect(() => {
    (async () => {
      const [empRes, profileRes, actorRes] = await Promise.all([
        supabase.from("employees").select("name, email").is("deleted_at", null),
        supabase.from("user_profiles").select("email, full_name"),
        // 取樣近期紀錄以列出實際出現過的來源標記（telegram-bot／portal:／cron:）
        supabase
          .from("audit_logs")
          .select("actor_email, actor_label")
          .order("id", { ascending: false })
          .limit(1000),
      ]);

      const byEmail: Record<string, string> = {};
      for (const p of (profileRes.data ?? []) as { email?: unknown; full_name?: unknown }[]) {
        const em = String(p.email ?? "").trim().toLowerCase();
        const nm = String(p.full_name ?? "").trim();
        if (em && nm) byEmail[em] = nm;
      }
      // 員工姓名優先於 user_profiles.full_name
      for (const e of (empRes.data ?? []) as { name?: unknown; email?: unknown }[]) {
        const em = String(e.email ?? "").trim().toLowerCase();
        const nm = String(e.name ?? "").trim();
        if (em && nm) byEmail[em] = nm;
      }
      setNameByEmail(byEmail);

      const emails = new Set<string>();
      const labels = new Set<string>();
      for (const r of (actorRes.data ?? []) as {
        actor_email?: unknown;
        actor_label?: unknown;
      }[]) {
        const em = String(r.actor_email ?? "").trim();
        if (em) emails.add(em);
        else {
          const lb = String(r.actor_label ?? "").trim();
          if (lb) labels.add(lb);
        }
      }
      const opts: ActorOption[] = [
        ...[...emails]
          .map((em) => ({
            value: `email:${em}`,
            label: byEmail[em.toLowerCase()] ? `${byEmail[em.toLowerCase()]}（${em}）` : em,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, "zh-Hant")),
        ...[...labels]
          .map((lb) => ({ value: `label:${lb}`, label: describeActorLabel(lb, channelNames) }))
          .sort((a, b) => a.label.localeCompare(b.label, "zh-Hant")),
      ];
      setActorOptions(opts);
    })();
  }, [channelNames]);

  const actorText = useCallback(
    (row: AuditRow): string => {
      if (row.actor_email) {
        return nameByEmail[row.actor_email.trim().toLowerCase()] ?? row.actor_email;
      }
      return describeActorLabel(row.actor_label ?? "", channelNames);
    },
    [channelNames, nameByEmail],
  );

  const tableOptions = useMemo(
    () => Object.entries(TABLE_LABELS).sort((a, b) => a[1].localeCompare(b[1], "zh-Hant")),
    [],
  );

  async function loadMore() {
    if (rows.length === 0) return;
    setLoadingMore(true);
    await fetchLogs(true, rows[rows.length - 1].id);
    setLoadingMore(false);
  }

  function renderDetail(row: AuditRow) {
    if (row.action === "UPDATE") {
      const fields = row.changed_fields ?? [];
      return (
        <div className="flex flex-col gap-1.5">
          {fields.map((f) => (
            <div key={f} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="font-mono font-medium text-foreground">{f}</span>
              <span className="text-muted-foreground line-through break-all">
                {truncate(formatValue(row.old_data?.[f]))}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="text-foreground break-all">{truncate(formatValue(row.new_data?.[f]))}</span>
            </div>
          ))}
        </div>
      );
    }
    const data = row.action === "DELETE" ? row.old_data : row.new_data;
    if (!data) return <span className="text-xs text-muted-foreground">（無內容）</span>;
    const entries = Object.entries(data).filter(([, v]) => v !== null && v !== "");
    return (
      <div className="flex flex-col gap-1 text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono font-medium text-foreground">{k}</span>
            <span className="text-muted-foreground break-all">{truncate(formatValue(v))}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ScrollText className="h-4 w-4" />
          <span>操作紀錄 · 主要資料表的新增／修改／刪除由系統自動記錄（僅管理員可見）</span>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9 w-fit px-3 text-xs"
          onClick={() => fetchLogs(false)}
        >
          <RotateCw className="mr-1 h-3.5 w-3.5" />
          重新整理
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterTable}
          onChange={(e) => setFilterTable(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">資料表：全部</option>
          {tableOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">動作：全部</option>
          <option value="INSERT">新增</option>
          <option value="UPDATE">修改</option>
          <option value="DELETE">刪除</option>
        </select>
        <select
          value={filterActor}
          onChange={(e) => setFilterActor(e.target.value)}
          className="h-9 max-w-[14rem] rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">操作者：全部</option>
          {actorOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 items-center gap-2">
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <input
          type="text"
          value={filterRecord}
          onChange={(e) => setFilterRecord(e.target.value)}
          placeholder="紀錄 ID（前綴）"
          className="h-9 w-40 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          載入操作紀錄中…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          沒有符合條件的紀錄
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="whitespace-nowrap">時間</TableHead>
                <TableHead className="whitespace-nowrap">操作者</TableHead>
                <TableHead className="whitespace-nowrap">動作</TableHead>
                <TableHead className="whitespace-nowrap">資料表</TableHead>
                <TableHead className="whitespace-nowrap">內容</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const action = ACTION_LABELS[row.action] ?? {
                  label: row.action,
                  className: "bg-muted text-muted-foreground",
                };
                const expanded = expandedId === row.id;
                return (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                    >
                      <TableCell className="pr-0 text-muted-foreground">
                        {expanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {formatTime(row.happened_at)}
                      </TableCell>
                      <TableCell
                        className="max-w-[180px] truncate text-xs"
                        title={row.actor_email ?? row.actor_label ?? undefined}
                      >
                        {actorText(row)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${action.className}`}
                        >
                          {action.label}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {TABLE_LABELS[row.table_name] ?? row.table_name}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                        {row.action === "UPDATE"
                          ? `${summaryOf(row)} · 改了 ${(row.changed_fields ?? []).length} 個欄位`
                          : summaryOf(row)}
                      </TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={5} className="py-3">
                          <div className="mb-2 text-[11px] text-muted-foreground">
                            紀錄 ID：<span className="font-mono">{row.record_id ?? "—"}</span>
                          </div>
                          {renderDetail(row)}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && hasMore ? (
        <Button
          type="button"
          variant="outline"
          className="h-9 self-center px-4 text-xs"
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? "載入中…" : "載入更多"}
        </Button>
      ) : null}
    </div>
  );
}
