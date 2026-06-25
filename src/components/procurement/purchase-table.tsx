"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAmortizationLabel } from "@/lib/purchase-amortization";
import type { PurchaseRow } from "@/types/procurement";
import { Pencil, Trash2, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

const COL_SPAN_BASE = 11;

export interface PurchaseTableProps {
  records: PurchaseRow[];
  totalUnfilteredCount: number;
  onEdit?: (row: PurchaseRow) => void;
  onDelete?: (row: PurchaseRow) => void;
}

export function PurchaseTable({ records, totalUnfilteredCount, onEdit, onDelete }: PurchaseTableProps) {
  const [page, setPage] = useState(0);
  /** 單一物件避免在 setSortKey updater 內呼叫 setSortDir（Strict Mode 會重複執行 updater，導致方向被切兩次） */
  const [sort, setSort] = useState<{ key: keyof PurchaseRow; dir: "asc" | "desc" }>({
    key: "purchase_date",
    dir: "desc",
  });

  const sortedRecords = useMemo(() => {
    const { key: sortKey, dir: sortDir } = sort;
    const list = [...records];
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];

      if (av == null && bv == null) return 0;
      if (av == null) return sortDir === "asc" ? -1 : 1;
      if (bv == null) return sortDir === "asc" ? 1 : -1;

      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }

      if (typeof av === "boolean" && typeof bv === "boolean") {
        const an = av ? 1 : 0;
        const bn = bv ? 1 : 0;
        return sortDir === "asc" ? an - bn : bn - an;
      }

      const as = String(av);
      const bs = String(bv);
      const cmp = as.localeCompare(bs, "zh-Hant");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [records, sort]);

  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const start = page * PAGE_SIZE;
  const pageRecords = sortedRecords.slice(start, start + PAGE_SIZE);

  function toggleSort(key: keyof PurchaseRow) {
    setPage(0);
    setSort((prev) => {
      if (prev.key !== key) {
        return { key, dir: "asc" };
      }
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  function SortHeader({
    label,
    sortKey: colKey,
    align = "left",
  }: {
    label: string;
    sortKey: keyof PurchaseRow;
    align?: "left" | "right";
  }) {
    const active = sort.key === colKey;
    return (
      <button
        type="button"
        onClick={() => toggleSort(colKey)}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-semibold p-2 align-middle hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded",
          align === "right" && "w-full justify-end",
        )}
        aria-label={`依${label}排序${active ? (sort.dir === "asc" ? "升冪" : "降冪") : ""}`}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
    );
  }

  const emptyColSpan = onEdit || onDelete ? COL_SPAN_BASE + 1 : COL_SPAN_BASE;

  return (
    <>
      <Table className="min-w-[72rem]">
        <TableHeader>
          <TableRow className="hover:bg-transparent border-b border-border">
            <TableHead className="p-2 align-middle">
              <SortHeader label="日期" sortKey="purchase_date" />
            </TableHead>
            <TableHead className="p-2 align-middle">
              <SortHeader label="廠商" sortKey="vendor_name" />
            </TableHead>
            <TableHead className="p-2 align-middle">
              <SortHeader label="品名" sortKey="item_name" />
            </TableHead>
            <TableHead className="p-2 align-middle">
              <SortHeader label="類別" sortKey="item_category" />
            </TableHead>
            <TableHead className="p-2 align-middle">
              <SortHeader label="規格" sortKey="spec_primary" />
            </TableHead>
            <TableHead className="p-2 align-middle">
              <SortHeader label="規格2" sortKey="spec_secondary" />
            </TableHead>
            <TableHead className="p-2 align-middle">
              <SortHeader label="數量" sortKey="quantity" />
            </TableHead>
            <TableHead className="p-2 align-middle">
              <SortHeader label="單位" sortKey="unit" />
            </TableHead>
            <TableHead className="p-2 text-right align-middle">
              <SortHeader label="已稅單價" sortKey="unit_price_inc_tax" align="right" />
            </TableHead>
            <TableHead className="p-2 text-right align-middle">
              <SortHeader label="含稅總價" sortKey="tax_included_amount" align="right" />
            </TableHead>
            <TableHead className="p-2 align-middle">
              <SortHeader label="攤提" sortKey="amortization_months" />
            </TableHead>
            {(onEdit || onDelete) && (
              <TableHead className="text-xs font-semibold p-2" aria-label="操作">操作</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRecords.length === 0 ? (
            <TableRow>
              <TableCell colSpan={emptyColSpan} className="h-24 text-center text-muted-foreground text-sm">
                尚無採購紀錄
              </TableCell>
            </TableRow>
          ) : (
            pageRecords.map((record) => (
              <TableRow key={record.id} className="border-b border-border hover:bg-muted/30">
                <TableCell className="text-sm p-2 whitespace-nowrap">{record.purchase_date}</TableCell>
                <TableCell className="text-sm p-2">
                  <span className="inline-flex flex-wrap items-baseline gap-x-0">
                    <span>{record.vendor_name}</span>
                    {record.vendor_notes?.trim() ? (
                      <span className="text-muted-foreground">&nbsp;（{record.vendor_notes.trim()}）</span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-sm p-2">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span>{record.item_name}</span>
                    {record.material_id ? (
                      <span className="rounded border border-border px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground" title="已對應採購物料主檔">
                        主檔
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground p-2">{record.item_category || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground p-2">{record.spec_primary.trim() ? record.spec_primary : "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground p-2">{record.spec_secondary.trim() ? record.spec_secondary : "—"}</TableCell>
                <TableCell className="text-sm p-2">{record.quantity}</TableCell>
                <TableCell className="text-sm p-2">{record.unit || "—"}</TableCell>
                <TableCell className="text-sm text-right p-2 tabular-nums">{record.unit_price_inc_tax.toLocaleString()}</TableCell>
                <TableCell className="text-sm text-right p-2 font-medium tabular-nums">{record.tax_included_amount.toLocaleString()}</TableCell>
                <TableCell className="text-sm text-muted-foreground p-2 whitespace-nowrap">
                  {formatAmortizationLabel(record.amortization_months)}
                </TableCell>
                {(onEdit || onDelete) && (
                  <TableCell className="p-2">
                    <div className="flex items-center gap-1">
                      {onEdit && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(record)} aria-label={`編輯 ${record.item_name}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {onDelete && (
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(record); }} aria-label={`刪除 ${record.item_name}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {records.length > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <span className="text-xs text-muted-foreground">
            第 {page + 1} / {totalPages} 頁，共 {records.length} 筆
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-8 px-3 text-xs"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              上一頁
            </Button>
            <Button
              variant="outline"
              className="h-8 px-3 text-xs"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              下一頁
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
