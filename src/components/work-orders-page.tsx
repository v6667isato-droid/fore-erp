"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { User, Wrench, CalendarDays, RefreshCw, CalendarPlus } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";

type WorkStage =
  | "待排程"
  | "開料中"
  | "榫接中"
  | "打磨中"
  | "上油中"
  | "組裝中"
  | "完成待出貨";

type WorkStatus = "未開始" | "進行中" | "暫停" | "已完成";

interface WorkOrderRow {
  id: string;
  order_item_id: string;
  order_number: string;
  customer_name: string;
  item_name: string;
  category: string;
  stage: WorkStage;
  status: WorkStatus;
  assignee: string | null;
  expected_delivery_date: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  note: string | null;
}

interface EmployeeOption {
  id: string;
  name: string;
}

const STAGE_OPTIONS: WorkStage[] = [
  "待排程",
  "開料中",
  "榫接中",
  "打磨中",
  "上油中",
  "組裝中",
  "完成待出貨",
];

const STATUS_OPTIONS: WorkStatus[] = [
  "未開始",
  "進行中",
  "暫停",
  "已完成",
];

export function WorkOrdersPage() {
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<WorkStage | "全部">("全部");
  const [statusFilter, setStatusFilter] = useState<WorkStatus | "全部">("進行中");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  useEffect(() => {
    bootstrap();
  }, []);

  async function bootstrap() {
    setLoading(true);
    // 讀取員工名單（只用來提供下拉選單）
    const { data: empData } = await supabase
      .from("employees")
      .select("id, name")
      .order("name", { ascending: true });
    setEmployees(
      ((empData ?? []) as any[]).map((e) => ({
        id: String(e.id),
        name: String(e.name ?? ""),
      }))
    );
    await fetchWorkOrders();
    setLoading(false);
  }

  async function fetchWorkOrders() {
    const { data, error } = await supabase
      .from("work_orders")
      .select(
        `
        id,
        stage,
        status,
        assignee,
        planned_start_date,
        planned_end_date,
        order_items(
          id,
          custom_name,
          custom_category,
          custom_description,
          custom_dimension_w,
          custom_dimension_d,
          custom_dimension_h,
          quantity,
          orders(
            order_number,
            expected_delivery_date,
            customers(name)
          ),
          product_variants(
            product_code,
            wood_type,
            dimension_w,
            dimension_d,
            dimension_h
          )
        )
      `
      )
      .order("planned_start_date", { ascending: true });

    if (error) {
      console.error("讀取工單失敗:", error);
      toast.error("工單讀取失敗");
      setRows([]);
      setLoading(false);
      return;
    }

    const mapped: WorkOrderRow[] = ((data ?? []) as any[]).map((r) => {
      const oi = r.order_items;
      const variant = oi?.product_variants;
      const order = oi?.orders;
      const customerRel = order?.customers;

      const customerName =
        (customerRel && customerRel.name) ||
        (Array.isArray(customerRel) && customerRel[0]?.name) ||
        "";

      let itemName = "";
      if (oi?.custom_name) {
        itemName = String(oi.custom_name);
      } else if (variant?.product_code) {
        itemName = String(variant.product_code);
      }

      const cat =
        (oi?.custom_category as string | null | undefined)?.trim() || "";

      const w = oi?.custom_dimension_w ?? variant?.dimension_w ?? null;
      const d = oi?.custom_dimension_d ?? variant?.dimension_d ?? null;
      const h = oi?.custom_dimension_h ?? variant?.dimension_h ?? null;
      const parts = [w, d, h].filter((x) => x != null);
      const dim =
        parts.length === 0
          ? ""
          : `W:${w ?? "—"} x D:${d ?? "—"} x H:${h ?? "—"}`;

      const fullNameParts = [itemName, dim].filter(
        (s) => typeof s === "string" && s.trim()
      ) as string[];

      return {
        id: String(r.id),
        order_item_id: oi?.id ? String(oi.id) : "",
        order_number: order?.order_number
          ? String(order.order_number)
          : "",
        customer_name: customerName,
        item_name: fullNameParts.join(" / "),
        category: cat,
        stage: (r.stage as WorkStage) ?? "待排程",
        status: (r.status as WorkStatus) ?? "未開始",
        assignee: r.assignee ?? null,
        expected_delivery_date: order?.expected_delivery_date ?? null,
        planned_start_date: r.planned_start_date ?? null,
        planned_end_date: r.planned_end_date ?? null,
        note: oi?.custom_description ?? null,
      };
    });

    setRows(mapped);
  }

  async function updateWorkOrderInline(
    id: string,
    patch: Partial<Pick<WorkOrderRow, "stage" | "status" | "assignee">>
  ) {
    const payload: any = {};
    if (patch.stage) payload.stage = patch.stage;
    if (patch.status) payload.status = patch.status;
    if (patch.assignee !== undefined) payload.assignee = patch.assignee;
    if (Object.keys(payload).length === 0) return;

    const { error } = await supabase
      .from("work_orders")
      .update(payload)
      .eq("id", id);
    if (error) {
      toast.error(error.message || "更新工單失敗");
      return;
    }
    setRows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...patch } : w))
    );
  }

  const filtered = useMemo(() => {
    return rows.filter((w) => {
      const matchStage =
        stageFilter === "全部" || w.stage === stageFilter;
      const matchStatus =
        statusFilter === "全部" || w.status === statusFilter;
      const q = assigneeFilter.trim().toLowerCase();
      const matchAssignee =
        !q ||
        (w.assignee ?? "").toLowerCase().includes(q) ||
        w.customer_name.toLowerCase().includes(q) ||
        w.order_number.toLowerCase().includes(q);
      return matchStage && matchStatus && matchAssignee;
    });
  }, [rows, stageFilter, statusFilter, assigneeFilter]);

  const uniqueAssignees = useMemo(
    () => employees.map((e) => e.name).filter(Boolean),
    [employees]
  );

  function buildGoogleCalendarUrl(w: WorkOrderRow): string | null {
    const dateRaw = w.planned_end_date ?? w.expected_delivery_date;
    if (!dateRaw) return null;

    const d = new Date(dateRaw);
    if (Number.isNaN(d.getTime())) return null;

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const ymd = `${year}${month}${day}`;

    const text = `[${w.customer_name || "未命名客戶"}] ${
      w.item_name || "未命名品項"
    } / ${w.stage}`;

    const detailsLines = [
      `訂單編號：${w.order_number || "—"}`,
      `負責人：${w.assignee || "未指派"}`,
      `備註：${w.note || "—"}`,
    ];
    const details = detailsLines.join("\n");

    const params = new URLSearchParams({
      action: "TEMPLATE",
      text,
      dates: `${ymd}/${ymd}`,
      details,
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          載入工單中…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wrench className="h-4 w-4" />
          <span>工單列表 · 依品項追蹤生產進度</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={stageFilter}
            onChange={(e) =>
              setStageFilter(
                e.target.value === "全部"
                  ? "全部"
                  : (e.target.value as WorkStage)
              )
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="全部">工序：全部</option>
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value === "全部"
                  ? "全部"
                  : (e.target.value as WorkStatus)
              )
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="全部">狀態：全部</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            placeholder="搜尋客戶 / 訂單 / 負責人…"
            className="h-8 min-w-[12rem] rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={fetchWorkOrders}
            aria-label="重新整理工單"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs font-semibold">訂單編號</TableHead>
              <TableHead className="text-xs font-semibold">
                客戶 / 專案
              </TableHead>
              <TableHead className="text-xs font-semibold">
                品項 / 尺寸
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">
                類別
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">
                工序站別
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">
                工單狀態
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">
                負責人
              </TableHead>
              <TableHead className="text-xs font-semibold hidden sm:table-cell">
                預計完成
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-24 text-center text-muted-foreground"
                >
                  目前尚無工單或不符合篩選條件。
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((w) => {
                const calendarUrl = buildGoogleCalendarUrl(w);
                return (
                <TableRow key={w.id} className="border-b border-border">
                  <TableCell className="font-mono text-xs font-medium">
                    {w.order_number || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {w.customer_name || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {w.item_name || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                    {w.category || "—"}
                  </TableCell>
                  <TableCell className="text-sm hidden sm:table-cell">
                    <select
                      value={w.stage}
                      onChange={(e) =>
                        updateWorkOrderInline(w.id, {
                          stage: e.target.value as WorkStage,
                        })
                      }
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {STAGE_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="text-sm hidden sm:table-cell">
                    <select
                      value={w.status}
                      onChange={(e) =>
                        updateWorkOrderInline(w.id, {
                          status: e.target.value as WorkStatus,
                        })
                      }
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="text-sm hidden sm:table-cell">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <select
                        value={w.assignee ?? ""}
                        onChange={(e) =>
                          updateWorkOrderInline(w.id, {
                            assignee: e.target.value || null,
                          })
                        }
                        className="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">未指派</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.name}>
                            {emp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>
                        {w.planned_end_date
                          ? formatDate(w.planned_end_date)
                          : w.expected_delivery_date
                          ? formatDate(w.expected_delivery_date)
                          : "—"}
                      </span>
                      {calendarUrl && (
                        <a
                          href={calendarUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="加到 Google 行事曆"
                          className="inline-flex h-7 w-7 ml-1 items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                        >
                          <CalendarPlus className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )})
            )}
          </TableBody>
        </Table>
      </div>

      <datalist id="work-orders-assignees">
        {uniqueAssignees.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <p className="text-xs text-muted-foreground">
        顯示 {filtered.length} / {rows.length} 筆工單
      </p>
    </div>
  );
}

