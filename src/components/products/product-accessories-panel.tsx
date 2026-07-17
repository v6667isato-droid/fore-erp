"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  TABLE_PRODUCT_ACCESSORIES,
  PRODUCT_ACCESSORY_SELECT,
  mapProductAccessory,
  type ProductAccessoryRow,
} from "@/lib/product-accessories-db";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { ProductAccessoryFormDialog } from "@/components/products/product-accessory-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

type SortKey = "category" | "name" | "spec" | "material" | "price";

/** 配件表列表面板：門框、坐墊、坐墊布料等配件選項，依分類篩選 */
export function ProductAccessoriesPanel() {
  const [rows, setRows] = useState<ProductAccessoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "category", asc: true });
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<ProductAccessoryRow | null>(null);
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<ProductAccessoryRow | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from(TABLE_PRODUCT_ACCESSORIES)
      .select(PRODUCT_ACCESSORY_SELECT)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      setLoadError(error.message || "無法讀取配件表");
      setRows([]);
    } else {
      setRows(((data ?? []) as unknown as Record<string, unknown>[]).map(mapProductAccessory));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const categories = useMemo(() => {
    return [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
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
      if (sort.key === "price") {
        const aVal = a.price ?? Number.POSITIVE_INFINITY;
        const bVal = b.price ?? Number.POSITIVE_INFINITY;
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
      .from(TABLE_PRODUCT_ACCESSORIES)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除配件");
    setEditRow(null);
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
        載入配件表資料中…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-5 space-y-3">
        <p className="font-medium text-foreground">無法讀取配件表資料</p>
        <p className="text-sm text-destructive break-all">{loadError}</p>
        <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => void fetchData()}>
          重新載入
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          產品可搭配的配件選項（門框、坐墊、坐墊布料等），僅供內部參考。
          <span className="ml-2">共 {rows.length} 筆</span>
        </div>
        <Button className="h-9 shrink-0 gap-2 px-4 text-sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          新增配件
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground shrink-0">篩選分類</span>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依分類篩選"
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
              <TableHead className="text-xs font-semibold p-2">{sortButton("category", "分類")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("name", "名稱")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("spec", "規格")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("material", "材質")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">{sortButton("price", "定價")}</TableHead>
              <TableHead className="text-xs font-semibold p-2">備註</TableHead>
              <TableHead className="text-xs font-semibold p-2 min-w-[90px] text-right" aria-label="操作">
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {rows.length === 0
                    ? "尚無配件資料，請點「新增配件」建立。"
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
                          alt={row.name || "配件圖片"}
                          className="h-full w-full object-cover"
                        />
                      </span>
                    ) : (
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-muted text-[10px] text-muted-foreground">
                        無圖
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">{row.category || "—"}</TableCell>
                  <TableCell className="text-sm font-medium p-2">
                    <button
                      type="button"
                      onClick={() => setEditRow(row)}
                      className="text-left text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded"
                    >
                      {row.name || "—"}
                    </button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">{row.spec || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2">{row.material || "—"}</TableCell>
                  <TableCell className="text-sm p-2">
                    {row.price != null ? row.price.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground p-2 max-w-[200px] truncate" title={row.notes ?? undefined}>
                    {row.notes || "—"}
                  </TableCell>
                  <TableCell className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditRow(row)} aria-label={`編輯 ${row.name}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirmRow(row)}
                        aria-label={`刪除 ${row.name}`}
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

      <ProductAccessoryFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        row={null}
        onSuccess={() => void fetchData()}
      />
      <ProductAccessoryFormDialog
        open={editRow != null}
        onOpenChange={(open) => !open && setEditRow(null)}
        row={editRow}
        onSuccess={() => {
          setEditRow(null);
          void fetchData();
        }}
      />
      <ConfirmDialog
        open={deleteConfirmRow != null}
        onOpenChange={(open) => !open && setDeleteConfirmRow(null)}
        title="是否確定刪除此配件？"
        description={
          deleteConfirmRow ? (
            <>
              <p className="font-medium text-foreground">
                「{deleteConfirmRow.category ? `${deleteConfirmRow.category} · ` : ""}
                {deleteConfirmRow.name || "未命名"}」
              </p>
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
