"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TABLE_CUSTOM_CASES,
  CUSTOM_CASE_SELECT,
  CUSTOM_CASE_KIND_LABEL,
  formatCaseDimensions,
  mapCustomCase,
  type CustomCaseKind,
  type CustomCaseRow,
} from "@/lib/custom-cases-db";
import { Plus, Eye, Pencil, Trash2 } from "lucide-react";
import { CustomCaseFormDialog } from "@/components/products/custom-case-form-dialog";
import { ViewCustomCaseDialog } from "@/components/products/view-custom-case-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

type SortKey = "case_code" | "name_zh" | "category" | "material" | "completed_year" | "published" | "base_price";

/** 訂製案例（kind=custom）與加工區（kind=processing）共用的列表面板 */
export function CustomCasesPanel({ kind }: { kind: CustomCaseKind }) {
  const kindLabel = CUSTOM_CASE_KIND_LABEL[kind];
  const [rows, setRows] = useState<CustomCaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "case_code", asc: true });
  const [addOpen, setAddOpen] = useState(false);
  const [viewRow, setViewRow] = useState<CustomCaseRow | null>(null);
  const [editRow, setEditRow] = useState<CustomCaseRow | null>(null);
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<CustomCaseRow | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from(TABLE_CUSTOM_CASES)
      .select(CUSTOM_CASE_SELECT)
      .eq("kind", kind)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      setLoadError(error.message || `無法讀取${kindLabel}`);
      setRows([]);
    } else {
      setRows(((data ?? []) as unknown as Record<string, unknown>[]).map(mapCustomCase));
    }
    setLoading(false);
  }, [kind, kindLabel]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const categories = useMemo(() => {
    return [...new Set(rows.map((r) => r.category).filter((c): c is string => Boolean(c)))].sort(
      (a, b) => a.localeCompare(b)
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!filterCategory) return rows;
    return rows.filter((r) => r.category === filterCategory);
  }, [rows, filterCategory]);

  const sortedRows = useMemo(() => {
    const base = [...filteredRows];
    const ascFactor = sort.asc ? 1 : -1;
    base.sort((a, b) => {
      if (sort.key === "published") {
        return ascFactor * (Number(a.published) - Number(b.published));
      }
      if (sort.key === "base_price") {
        const aVal = a.base_price ?? Number.POSITIVE_INFINITY;
        const bVal = b.base_price ?? Number.POSITIVE_INFINITY;
        return ascFactor * (aVal - bVal);
      }
      const aVal = a[sort.key] ?? "";
      const bVal = b[sort.key] ?? "";
      return ascFactor * String(aVal).localeCompare(String(bVal));
    });
    return base;
  }, [filteredRows, sort]);

  async function performDelete() {
    if (!deleteConfirmRow) return;
    const row = deleteConfirmRow;
    setDeleteConfirmRow(null);
    const { error } = await supabase
      .from(TABLE_CUSTOM_CASES)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success(`已刪除${kindLabel}`);
    setViewRow(null);
    setEditRow(null);
    void fetchData();
  }

  async function togglePublished(row: CustomCaseRow) {
    const next = !row.published;
    const { error } = await supabase
      .from(TABLE_CUSTOM_CASES)
      .update({ published: next })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "更新發佈狀態失敗");
      return;
    }
    toast.success(next ? "已發佈到官網" : "已取消官網發佈");
    void fetchData();
  }

  function sortButton(key: SortKey, label: string) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 hover:text-primary"
        onClick={() =>
          setSort((prev) => ({ key, asc: prev.key === key ? !prev.asc : true }))
        }
        aria-label={`依${label}排序（目前為${sort.key === key && !sort.asc ? "降冪" : "升冪"}）`}
      >
        <span>{label}</span>
        <span className="inline-flex items-center justify-center h-4 w-4 text-sm leading-none text-muted-foreground">
          {sort.key === key ? (sort.asc ? "↑" : "↓") : "–"}
        </span>
      </button>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
        載入{kindLabel}資料中…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-5 space-y-3">
        <p className="font-medium text-foreground">無法讀取{kindLabel}資料</p>
        <p className="text-sm text-destructive break-all">{loadError}</p>
        <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => void fetchData()}>
          重新載入
        </Button>
      </div>
    );
  }

  const colCount = 8;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {kind === "custom"
            ? "訂製案例可設定發佈到官網「客製訂做」頁面。"
            : "維修保養等加工項目僅供內部紀錄，不會出現在官網。"}
          <span className="ml-2">共 {rows.length} 筆</span>
        </div>
        <Button className="h-9 shrink-0 gap-2 px-4 text-sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          新增{kindLabel === "加工區" ? "加工項目" : kindLabel}
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground shrink-0">篩選類別</span>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依類別篩選"
          >
            <option value="">全部</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground ml-auto">共 {filteredRows.length} 筆</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="text-xs font-semibold p-2 w-16">圖片</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("case_code", "編號")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("name_zh", "名稱")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("category", "類別")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("material", "材質")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">尺寸</TableHead>
              {kind === "processing" && (
                <TableHead className="text-xs font-semibold p-2">{sortButton("base_price", "定價")}</TableHead>
              )}
              <TableHead className="text-xs font-semibold p-2">{sortButton("completed_year", "完成年份")}</TableHead>
              {kind === "custom" && (
                <TableHead className="text-xs font-semibold p-2">{sortButton("published", "官網")}</TableHead>
              )}
              <TableHead className="text-xs font-semibold p-2 min-w-[120px] text-right" aria-label="操作">
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount + 1} className="h-24 text-center text-muted-foreground">
                  {rows.length === 0
                    ? `尚無${kindLabel}資料，請點「新增」建立。`
                    : "無符合篩選條件的資料。"}
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((row) => (
                <TableRow key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <TableCell className="p-2 align-middle">
                    {row.image_url ? (
                      <span className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={row.image_url}
                          alt={row.name_zh || "主圖"}
                          className="h-full w-full object-cover"
                        />
                      </span>
                    ) : (
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-muted text-[10px] text-muted-foreground">
                        無圖
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm p-2">{row.case_code || "—"}</TableCell>
                  <TableCell className="text-sm font-medium p-2">
                    <button
                      type="button"
                      onClick={() => setViewRow(row)}
                      className="text-left text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded"
                    >
                      <span className="flex flex-col">
                        <span>{row.name_zh || "—"}</span>
                        {row.name_en?.trim() && (
                          <span className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                            {row.name_en}
                          </span>
                        )}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">{row.category || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">{row.material || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">{formatCaseDimensions(row)}</TableCell>
                  {kind === "processing" && (
                    <TableCell className="text-sm p-2">
                      {row.base_price != null ? row.base_price.toLocaleString() : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-sm text-muted-foreground p-2">{row.completed_year || "—"}</TableCell>
                  {kind === "custom" && (
                    <TableCell className="p-2">
                      <button
                        type="button"
                        onClick={() => void togglePublished(row)}
                        className="focus:outline-none focus:ring-2 focus:ring-ring rounded"
                        aria-label={row.published ? `取消發佈 ${row.name_zh}` : `發佈 ${row.name_zh} 到官網`}
                        title={row.published ? "點擊取消官網發佈" : "點擊發佈到官網"}
                      >
                        {row.published ? (
                          <Badge>發佈中</Badge>
                        ) : (
                          <Badge variant="secondary">未發佈</Badge>
                        )}
                      </button>
                    </TableCell>
                  )}
                  <TableCell className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewRow(row)} aria-label={`檢視 ${row.name_zh}`}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditRow(row)} aria-label={`編輯 ${row.name_zh}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirmRow(row)}
                        aria-label={`刪除 ${row.name_zh}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CustomCaseFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        kind={kind}
        row={null}
        categorySuggestions={categories}
        onSuccess={() => void fetchData()}
      />
      <CustomCaseFormDialog
        open={editRow != null}
        onOpenChange={(open) => !open && setEditRow(null)}
        kind={kind}
        row={editRow}
        categorySuggestions={categories}
        onSuccess={() => {
          setEditRow(null);
          void fetchData();
        }}
      />
      <ViewCustomCaseDialog
        open={viewRow != null}
        onOpenChange={(open) => !open && setViewRow(null)}
        row={viewRow}
      />
      <ConfirmDialog
        open={deleteConfirmRow != null}
        onOpenChange={(open) => !open && setDeleteConfirmRow(null)}
        title={`是否確定刪除此${kindLabel === "加工區" ? "加工項目" : kindLabel}？`}
        description={
          deleteConfirmRow ? (
            <>
              <p className="font-medium text-foreground">
                「{deleteConfirmRow.case_code ? `${deleteConfirmRow.case_code} · ` : ""}
                {deleteConfirmRow.name_zh || "未命名"}」
              </p>
              {deleteConfirmRow.kind === "custom" && deleteConfirmRow.published && (
                <p className="mt-2 text-muted-foreground">此案例目前發佈在官網上，刪除後將自官網移除。</p>
              )}
              <p className="mt-2 text-muted-foreground">此操作無法復原。</p>
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={performDelete}
        destructive
      />
    </div>
  );
}
