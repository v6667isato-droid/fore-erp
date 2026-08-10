"use client";

import { Fragment, useState, useMemo } from "react";
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
import { displayPoNumber, type PurchaseOrderGroup } from "@/lib/purchase-order";
import { PO_INVOICE_MATCH_LABELS, type PoInvoiceMatch } from "@/lib/po-invoice-match";
import {
  Pencil,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  ChevronDown,
  Paperclip,
  FileUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

const COL_SPAN_BASE = 7;

/**
 * 對應發票狀態徽章（與會計管理發票清單的「對應採購單」欄同款三態）。
 * 「有相符」可點：前往會計管理並帶入該發票號碼搜尋，在發票端完成對應。
 */
export function InvoiceMatchBadge({
  match,
  onOpenInvoice,
}: {
  match?: PoInvoiceMatch;
  onOpenInvoice?: (invoiceNumber: string) => void;
}) {
  const state = match?.state ?? "none";
  const tone =
    state === "matched"
      ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
      : state === "candidate"
        ? "border-sky-500/50 text-sky-700 dark:text-sky-400"
        : "border-border text-muted-foreground";
  const candidateNumber = state === "candidate" ? match?.invoice?.invoice_number : null;
  if (candidateNumber && onOpenInvoice) {
    return (
      <button
        type="button"
        className={`rounded border px-1.5 py-px text-xs font-medium whitespace-nowrap underline decoration-dotted underline-offset-2 hover:bg-sky-500/10 focus:outline-none focus:ring-2 focus:ring-ring ${tone}`}
        title={match?.detail || undefined}
        onClick={(e) => {
          e.stopPropagation();
          onOpenInvoice(candidateNumber);
        }}
        aria-label={`前往會計管理確認發票 ${candidateNumber} 的對應`}
      >
        {PO_INVOICE_MATCH_LABELS[state]}
      </button>
    );
  }
  return (
    <span className={`rounded border px-1.5 py-px text-xs font-medium whitespace-nowrap ${tone}`} title={match?.detail || undefined}>
      {PO_INVOICE_MATCH_LABELS[state]}
    </span>
  );
}

type GroupSortKey = "po_number" | "purchase_date" | "vendor_name" | "total_inc_tax";

export interface PurchaseTableProps {
  groups: PurchaseOrderGroup[];
  totalUnfilteredCount: number;
  /** 各採購單的發票對應狀態（key=group.key）；未提供則不顯示「對應發票」欄 */
  invoiceMatches?: Map<string, PoInvoiceMatch>;
  /** 點「有相符」徽章：前往會計管理並帶入發票號碼搜尋 */
  onOpenInvoice?: (invoiceNumber: string) => void;
  onEdit?: (row: PurchaseRow) => void;
  onDelete?: (row: PurchaseRow) => void;
  /** 編輯整張採購單（單頭＋所有品項） */
  onEditGroup?: (group: PurchaseOrderGroup) => void;
  /** 刪除整張採購單（單頭＋所有品項） */
  onDeleteGroup?: (group: PurchaseOrderGroup) => void;
  /** 上傳請款單附件到既有採購單 */
  onUploadInvoice?: (group: PurchaseOrderGroup) => void;
}

export function PurchaseTable({
  groups,
  totalUnfilteredCount,
  invoiceMatches,
  onOpenInvoice,
  onEdit,
  onDelete,
  onEditGroup,
  onDeleteGroup,
  onUploadInvoice,
}: PurchaseTableProps) {
  const [page, setPage] = useState(0);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  /** 單一物件避免在 setSortKey updater 內呼叫 setSortDir（Strict Mode 會重複執行 updater，導致方向被切兩次） */
  const [sort, setSort] = useState<{ key: GroupSortKey; dir: "asc" | "desc" }>({
    key: "purchase_date",
    dir: "desc",
  });

  const sortedGroups = useMemo(() => {
    const { key: sortKey, dir: sortDir } = sort;
    const list = [...groups];
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return sortDir === "asc" ? -1 : 1;
      if (bv == null) return sortDir === "asc" ? 1 : -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv), "zh-Hant");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [groups, sort]);

  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const start = page * PAGE_SIZE;
  const pageGroups = sortedGroups.slice(start, start + PAGE_SIZE);

  function toggleSort(key: GroupSortKey) {
    setPage(0);
    setSort((prev) => {
      if (prev.key !== key) {
        return { key, dir: "asc" };
      }
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function SortHeader({
    label,
    sortKey: colKey,
    align = "left",
  }: {
    label: string;
    sortKey: GroupSortKey;
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

  const hasActions = Boolean(onEdit || onDelete || onEditGroup || onDeleteGroup || onUploadInvoice);
  const emptyColSpan = COL_SPAN_BASE + (invoiceMatches ? 1 : 0) + (hasActions ? 1 : 0);

  return (
    <>
      <Table className="min-w-[56rem]">
        <TableHeader>
          <TableRow className="hover:bg-transparent border-b border-border">
            <TableHead className="p-2 align-middle">
              <SortHeader label="單號" sortKey="po_number" />
            </TableHead>
            <TableHead className="p-2 align-middle">
              <SortHeader label="日期" sortKey="purchase_date" />
            </TableHead>
            <TableHead className="p-2 align-middle">
              <SortHeader label="廠商" sortKey="vendor_name" />
            </TableHead>
            <TableHead className="text-xs font-semibold p-2 align-middle">品項</TableHead>
            <TableHead className="text-xs font-semibold p-2 align-middle text-center">附件</TableHead>
            {invoiceMatches && (
              <TableHead className="text-xs font-semibold p-2 align-middle">對應發票</TableHead>
            )}
            <TableHead className="p-2 text-right align-middle">
              <SortHeader label="含稅總計" sortKey="total_inc_tax" align="right" />
            </TableHead>
            <TableHead className="text-xs font-semibold p-2 align-middle" aria-label="展開" />
            {hasActions && (
              <TableHead className="text-xs font-semibold p-2" aria-label="操作">操作</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageGroups.length === 0 ? (
            <TableRow>
              <TableCell colSpan={emptyColSpan} className="h-24 text-center text-muted-foreground text-sm">
                {totalUnfilteredCount === 0 ? "尚無採購紀錄" : "無符合篩選條件的紀錄"}
              </TableCell>
            </TableRow>
          ) : (
            pageGroups.map((group) => {
              const isExpanded = expandedKeys.has(group.key);
              const firstLine = group.lines[0];
              return (
                <Fragment key={group.key}>
                  <TableRow
                    className="border-b border-border hover:bg-muted/30 cursor-pointer"
                    onClick={() => toggleExpand(group.key)}
                  >
                    <TableCell className="text-sm p-2 font-mono text-primary whitespace-nowrap">
                      {displayPoNumber(group.po_number)}
                    </TableCell>
                    <TableCell className="text-sm p-2 whitespace-nowrap">{group.purchase_date}</TableCell>
                    <TableCell className="text-sm p-2">
                      <span className="inline-flex flex-wrap items-baseline gap-x-0">
                        <span>{group.vendor_name}</span>
                        {group.vendor_notes?.trim() ? (
                          <span className="text-muted-foreground">&nbsp;（{group.vendor_notes.trim()}）</span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm p-2">
                      {group.lines.length === 1 ? (
                        <span>{firstLine?.item_name ?? "—"}</span>
                      ) : (
                        <span>
                          {firstLine?.item_name ?? "—"}
                          <span className="text-muted-foreground"> 等 {group.lines.length} 項</span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm p-2 text-center">
                      {group.invoice_files.length > 0 ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded px-1"
                          title={`檢視請款單附件：${group.invoice_files.map((f) => f.name).join("、")}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            for (const f of group.invoice_files) {
                              window.open(f.url, "_blank", "noopener,noreferrer");
                            }
                          }}
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          <span className="text-xs tabular-nums">{group.invoice_files.length}</span>
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    {invoiceMatches && (
                      <TableCell className="text-sm p-2">
                        <InvoiceMatchBadge match={invoiceMatches.get(group.key)} onOpenInvoice={onOpenInvoice} />
                      </TableCell>
                    )}
                    <TableCell className="text-sm text-right p-2 font-medium tabular-nums">
                      {group.total_inc_tax.toLocaleString()}
                    </TableCell>
                    <TableCell className="p-1 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        title={isExpanded ? "收合採購單內容" : "展開採購單內容（品項明細）"}
                        aria-expanded={isExpanded}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleExpand(group.key);
                        }}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </Button>
                    </TableCell>
                    {hasActions && (
                      <TableCell className="p-2">
                        <div className="flex items-center gap-1">
                          {onEditGroup && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="編輯整張採購單"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onEditGroup(group);
                              }}
                              aria-label={`編輯採購單 ${group.po_number ?? ""}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {onUploadInvoice && group.purchase_order_id && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="上傳請款單附件"
                              onClick={(e) => {
                                e.stopPropagation();
                                onUploadInvoice(group);
                              }}
                              aria-label={`上傳請款單附件到 ${group.po_number ?? "採購單"}`}
                            >
                              <FileUp className="h-4 w-4" />
                            </Button>
                          )}
                          {onDeleteGroup && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              title="刪除整張採購單"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onDeleteGroup(group);
                              }}
                              aria-label={`刪除採購單 ${group.po_number ?? ""}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                  {isExpanded && (
                    <TableRow className="border-b border-border bg-muted/20 hover:bg-muted/20">
                      <TableCell colSpan={emptyColSpan} className="p-0">
                        <div className="px-4 py-2">
                          {group.po_notes?.trim() ? (
                            <p className="mb-1.5 text-xs text-muted-foreground">備註：{group.po_notes.trim()}</p>
                          ) : null}
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-[11px] text-muted-foreground">
                                <th className="py-1 pr-2 font-medium">品名</th>
                                <th className="py-1 pr-2 font-medium">類別</th>
                                <th className="py-1 pr-2 font-medium">規格</th>
                                <th className="py-1 pr-2 font-medium">規格2</th>
                                <th className="py-1 pr-2 font-medium text-right">數量</th>
                                <th className="py-1 pr-2 font-medium">單位</th>
                                <th className="py-1 pr-2 font-medium text-right">已稅單價</th>
                                <th className="py-1 pr-2 font-medium text-right">含稅總價</th>
                                <th className="py-1 pr-2 font-medium">攤提</th>
                                {(onEdit || onDelete) && <th className="py-1 font-medium" aria-label="操作" />}
                              </tr>
                            </thead>
                            <tbody>
                              {group.lines.map((record) => (
                                <tr key={record.id} className="border-t border-border/60">
                                  <td className="py-1.5 pr-2">
                                    <span className="inline-flex flex-wrap items-center gap-1.5">
                                      <span>{record.item_name}</span>
                                      {record.material_id ? (
                                        <span
                                          className="rounded border border-border px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                                          title="已對應採購物料主檔"
                                        >
                                          主檔
                                        </span>
                                      ) : null}
                                    </span>
                                  </td>
                                  <td className="py-1.5 pr-2 text-muted-foreground">{record.item_category || "—"}</td>
                                  <td className="py-1.5 pr-2 text-muted-foreground">
                                    {record.spec_primary.trim() ? record.spec_primary : "—"}
                                  </td>
                                  <td className="py-1.5 pr-2 text-muted-foreground">
                                    {record.spec_secondary.trim() ? record.spec_secondary : "—"}
                                  </td>
                                  <td className="py-1.5 pr-2 text-right tabular-nums">{record.quantity}</td>
                                  <td className="py-1.5 pr-2">{record.unit || "—"}</td>
                                  <td className="py-1.5 pr-2 text-right tabular-nums">
                                    {record.unit_price_inc_tax.toLocaleString()}
                                  </td>
                                  <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                                    {record.tax_included_amount.toLocaleString()}
                                  </td>
                                  <td className="py-1.5 pr-2 text-muted-foreground whitespace-nowrap">
                                    {formatAmortizationLabel(record.amortization_months)}
                                  </td>
                                  {(onEdit || onDelete) && (
                                    <td className="py-1">
                                      <div className="flex items-center gap-1">
                                        {onEdit && (
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => onEdit(record)}
                                            aria-label={`編輯 ${record.item_name}`}
                                          >
                                            <Pencil className="h-3.5 w-3.5" />
                                          </Button>
                                        )}
                                        {onDelete && (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              onDelete(record);
                                            }}
                                            aria-label={`刪除 ${record.item_name}`}
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                        )}
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
      {groups.length > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <span className="text-xs text-muted-foreground">
            第 {page + 1} / {totalPages} 頁，共 {groups.length} 張採購單
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
