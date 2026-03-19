"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { User, MessageSquare, Wrench } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface KanbanCard {
  id: string;
  product: string;
  process: string;
  craftsman: string;
  note: string;
  orderId?: string;
  orderNumber?: string;
  orderStatus?: string | null;
}

interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

type NameRel = { name: string } | { name: string }[] | null | undefined;

function relName(rel: NameRel) {
  if (!rel) return "—";
  return Array.isArray(rel) ? rel[0]?.name ?? "—" : rel.name ?? "—";
}

const columnColors: Record<string, { bg: string; dot: string; headerBg: string }> = {
  todo: {
    bg: "bg-kanban-todo",
    dot: "bg-[var(--badge-pending)]",
    headerBg: "bg-[var(--badge-pending)]/30",
  },
  "in-progress": {
    bg: "bg-kanban-progress",
    dot: "bg-[var(--badge-progress)]",
    headerBg: "bg-[var(--badge-progress)]/30",
  },
  done: {
    bg: "bg-kanban-done",
    dot: "bg-[var(--badge-done)]",
    headerBg: "bg-[var(--badge-done)]/30",
  },
};

const statusToColumnId: Record<string, string> = {
  待處理: "todo",
  進行中: "in-progress",
  已完成: "done",
};

function KanbanCardItem({ card }: { card: KanbanCard }) {
  const handleOpenOrder = () => {
    if (!card.orderId) return;
    if (typeof window === "undefined") return;
    const encodedId = encodeURIComponent(card.orderId);
    // 保留在目前頁面，只更新網址 hash，交由主系統視情況處理
    window.location.hash = `orders:${encodedId}`;
  };

  return (
    <div className="group rounded-lg border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md hover:border-accent">
      <div className="flex flex-col gap-1">
        {card.orderNumber && (
          <button
            type="button"
            onClick={handleOpenOrder}
            className="self-start text-[11px] font-mono text-primary underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
          >
            {card.orderNumber}
          </button>
        )}
        <h4 className="font-serif text-sm font-semibold text-card-foreground">
          {card.product}
        </h4>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <Wrench className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium text-accent-foreground/80">{card.process}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <User className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{card.craftsman}</span>
      </div>
      {card.note && (
        <div className="mt-3 flex items-start gap-1.5 rounded-md bg-secondary/60 px-2.5 py-2">
          <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">{card.note}</p>
        </div>
      )}
    </div>
  );
}

function KanbanColumnView({ column }: { column: KanbanColumn }) {
  const colors = columnColors[column.id] ?? columnColors.todo;
  return (
    <div
      className={cn(
        "flex w-[300px] shrink-0 flex-col rounded-xl lg:w-auto lg:flex-1",
        colors.bg
      )}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className={cn("h-2.5 w-2.5 rounded-full", colors.dot)} />
          <h3 className="text-sm font-semibold text-foreground">{column.title}</h3>
        </div>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground/10 px-1.5 text-[10px] font-bold text-foreground/70">
          {column.cards.length}
        </span>
      </div>
      <div className="flex flex-col gap-2.5 px-3 pb-4">
        {column.cards.map((card) => (
          <KanbanCardItem key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}

export function KanbanPage() {
  const [columns, setColumns] = useState<KanbanColumn[]>([
    { id: "todo", title: "待處理", cards: [] },
    { id: "in-progress", title: "進行中", cards: [] },
    { id: "done", title: "已完成", cards: [] },
  ]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTasks() {
      setLoading(true);
      const { data, error } = await supabase
        .from("production_tasks")
        .select(`
          id,
          step_name,
          notes,
          status,
          employees(name),
          work_orders(
            batch_quantity,
            order_items(
              products(name),
              orders(
                id,
                order_number,
                status
              )
            )
          )
        `);

      if (error) {
        console.error("生產任務讀取失敗:", error);
        setColumns([
          { id: "todo", title: "待處理", cards: [] },
          { id: "in-progress", title: "進行中", cards: [] },
          { id: "done", title: "已完成", cards: [] },
        ]);
      } else {
        const todo: KanbanCard[] = [];
        const inProgress: KanbanCard[] = [];
        const done: KanbanCard[] = [];

        const rows = (data ?? []) as Array<{
          id: string;
          step_name: string | null;
          notes: string | null;
          status: string | null;
          employees: NameRel;
          work_orders:
            | {
                batch_quantity?: number;
                order_items?: Array<{
                  products: { name: string } | null;
                  orders:
                    | { id: string; order_number: string; status: string | null }
                    | { id: string; order_number: string; status: string | null }[]
                    | null;
                }>;
              }
            | Array<{
                batch_quantity?: number;
                order_items?: Array<{
                  products: { name: string } | null;
                  orders:
                    | { id: string; order_number: string; status: string | null }
                    | { id: string; order_number: string; status: string | null }[]
                    | null;
                }>;
              }>
            | null;
        }>;

        for (const row of rows) {
          const colId = statusToColumnId[row.status ?? ""] ?? "todo";
          const wo = Array.isArray(row.work_orders)
            ? row.work_orders[0]
            : row.work_orders;
          const firstItem = wo?.order_items?.[0];
          const productName = firstItem?.products?.name ?? "—";
          const orderRel = firstItem?.orders;
          const orderObj = Array.isArray(orderRel) ? orderRel[0] : orderRel;

          // 只顯示「非報價中」的訂單品項（報價中的品項可能更改，不排入生產看板）
          if (!orderObj || orderObj.status === "報價中") {
            continue;
          }
          const card: KanbanCard = {
            id: row.id,
            product: productName,
            process: row.step_name ?? "",
            craftsman: relName(row.employees),
            note: row.notes ?? "",
            orderId: orderObj.id,
            orderNumber: orderObj.order_number,
            orderStatus: orderObj.status ?? null,
          };
          if (colId === "todo") todo.push(card);
          else if (colId === "in-progress") inProgress.push(card);
          else done.push(card);
        }

        setColumns([
          { id: "todo", title: "待處理", cards: todo },
          { id: "in-progress", title: "進行中", cards: inProgress },
          { id: "done", title: "已完成", cards: done },
        ]);
      }
      setLoading(false);
    }
    fetchTasks();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          載入生產看板中…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {columns.map((col) => {
          const colors = columnColors[col.id] ?? columnColors.todo;
          return (
            <div
              key={col.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
            >
              <div className={cn("h-2 w-2 rounded-full", colors.dot)} />
              <span className="text-xs font-medium text-foreground">{col.title}</span>
              <span className="text-xs font-bold text-muted-foreground">{col.cards.length}</span>
            </div>
          );
        })}
      </div>

      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4 lg:grid lg:grid-cols-3">
          {columns.map((col) => (
            <KanbanColumnView key={col.id} column={col} />
          ))}
        </div>
        <ScrollBar orientation="horizontal" className="lg:hidden" />
      </ScrollArea>
    </div>
  );
}
