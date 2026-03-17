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
import type { PurchaseRow } from "@/types/procurement";
import { Pencil, Trash2 } from "lucide-react";

const PAGE_SIZE = 20;

export interface PurchaseTableProps {
  records: PurchaseRow[];
  totalUnfilteredCount: number;
  onEdit?: (row: PurchaseRow) => void;
  onDelete?: (row: PurchaseRow) => void;
}

export function PurchaseTable({ records, totalUnfilteredCount, onEdit, onDelete }: PurchaseTableProps) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<keyof PurchaseRow>("purchase_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sortedRecords = useMemo(() => {
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

      const as = String(av);
      const bs = String(bv);
      const cmp = as.localeCompare(bs, "zh-Hant");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [records, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const start = page * PAGE_SIZE;
  const pageRecords = sortedRecords.slice(start, start + PAGE_SIZE);

  function toggleSort(key: keyof PurchaseRow) {
    setPage(0);
    setSortKey((prevKey) => {
      if (prevKey !== key) {
        setSortDir("asc");
        return key;
      }
      setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
      return key;
    });
  }

  function headerLabel(label: string, key: keyof PurchaseRow) {
    const isActive = sortKey === key;
    const arrow = !isActive ? "" : sortDir === "asc" ? " ▲" : " ▼";
    return `${label}${arrow}`;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-b border-border">
            <TableHead
              className="text-xs font-semibold p-2 cursor-pointer select-none"
              onClick={() => toggleSort("purchase_date")}
            >
              {headerLabel("日期", "purchase_date")}
            </TableHead>
            <TableHead
              className="text-xs font-semibold p-2 cursor-pointer select-none"
              onClick={() => toggleSort("vendor_name")}
            >
              {headerLabel("廠商", "vendor_name")}
            </TableHead>
            <TableHead
              className="text-xs font-semibold p-2 cursor-pointer select-none"
              onClick={() => toggleSort("item_name")}
            >
              {headerLabel("品名", "item_name")}
            </TableHead>
            <TableHead
              className="text-xs font-semibold p-2 cursor-pointer select-none"
              onClick={() => toggleSort("item_category")}
            >
              {headerLabel("類別", "item_category")}
            </TableHead>
            <TableHead
              className="text-xs font-semibold p-2 cursor-pointer select-none"
              onClick={() => toggleSort("spec")}
            >
              {headerLabel("規格", "spec")}
            </TableHead>
            <TableHead
              className="text-xs font-semibold p-2 cursor-pointer select-none"
              onClick={() => toggleSort("quantity")}
            >
              {headerLabel("數量", "quantity")}
            </TableHead>
            <TableHead
              className="text-xs font-semibold p-2 cursor-pointer select-none"
              onClick={() => toggleSort("unit")}
            >
              {headerLabel("單位", "unit")}
            </TableHead>
            <TableHead
              className="text-xs font-semibold p-2 text-right cursor-pointer select-none"
              onClick={() => toggleSort("unit_price")}
            >
              {headerLabel("單價", "unit_price")}
            </TableHead>
            <TableHead
              className="text-xs font-semibold p-2 text-right cursor-pointer select-none"
              onClick={() => toggleSort("tax_included_amount")}
            >
              {headerLabel("含稅總價", "tax_included_amount")}
            </TableHead>
            {(onEdit || onDelete) && (
              <TableHead className="text-xs font-semibold p-2" aria-label="操作">操作</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRecords.length === 0 ? (
            <TableRow>
              <TableCell colSpan={onEdit || onDelete ? 10 : 9} className="h-24 text-center text-muted-foreground text-sm">
                尚無採購紀錄
              </TableCell>
            </TableRow>
          ) : (
            pageRecords.map((record) => (
              <TableRow key={record.id} className="border-b border-border hover:bg-muted/30">
                <TableCell className="text-sm p-2 whitespace-nowrap">{record.purchase_date}</TableCell>
                <TableCell className="text-sm p-2">{record.vendor_name}</TableCell>
                <TableCell className="text-sm p-2">{record.item_name}</TableCell>
                <TableCell className="text-sm text-muted-foreground p-2">{record.item_category || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground p-2">{record.spec || "—"}</TableCell>
                <TableCell className="text-sm p-2">{record.quantity}</TableCell>
                <TableCell className="text-sm p-2">{record.unit || "—"}</TableCell>
                <TableCell className="text-sm text-right p-2">{Number(record.unit_price ?? 0).toLocaleString()}</TableCell>
                <TableCell className="text-sm text-right p-2 font-medium">{record.tax_included_amount.toLocaleString()}</TableCell>
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
