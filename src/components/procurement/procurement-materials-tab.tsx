"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
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
import type { ProcurementMaterialRow } from "@/types/procurement";
import { AddMaterialDialog } from "@/components/procurement/add-material-dialog";
import { EditMaterialDialog } from "@/components/procurement/edit-material-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Plus, Pencil, Trash2, Search, Copy, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { formatAmortizationLabel, resolveDefaultAmortizationMonths } from "@/lib/purchase-amortization";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";

/** 下拉選單：僅「未填類別」的列 */
const FILTER_UNCATEGORIZED = "__uncategorized__";

type MaterialSortKey = "name" | "item_category" | "spec" | "spec2" | "unit" | "amortization_months" | "created_at";

export function ProcurementMaterialsTab() {
  const [records, setRecords] = useState<ProcurementMaterialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [sort, setSort] = useState<{ key: MaterialSortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<ProcurementMaterialRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<ProcurementMaterialRow | null>(null);
  const [copyRow, setCopyRow] = useState<ProcurementMaterialRow | null>(null);

  async function fetchMaterials() {
    setLoading(true);
    const { data, error } = await supabase
      .from("procurement_materials")
      .select("id, name, item_category, spec, spec2, unit, notes, amortization_months, created_at")
      .order("name");
    setLoading(false);
    if (error) {
      toast.error(error.message || "無法載入物料");
      setRecords([]);
      return;
    }
    setRecords((data as ProcurementMaterialRow[]) ?? []);
  }

  useEffect(() => {
    fetchMaterials();
  }, []);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      const c = r.item_category?.trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [records]);

  const hasUncategorized = useMemo(
    () => records.some((r) => !r.item_category?.trim()),
    [records],
  );

  const filtered = useMemo(() => {
    let list = records;
    if (filterCategory === FILTER_UNCATEGORIZED) {
      list = list.filter((r) => !r.item_category?.trim());
    } else if (filterCategory) {
      list = list.filter((r) => (r.item_category || "").trim() === filterCategory);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.item_category || "").toLowerCase().includes(q) ||
        (r.spec || "").toLowerCase().includes(q) ||
        (r.spec2 || "").toLowerCase().includes(q) ||
        (r.unit || "").toLowerCase().includes(q) ||
        (r.notes || "").toLowerCase().includes(q),
    );
  }, [records, filterCategory, search]);

  const sortedRows = useMemo(() => {
    const list = [...filtered];
    const { key, dir } = sort;
    list.sort((a, b) => {
      if (key === "created_at") {
        const at = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (at === bt) return 0;
        return dir === "asc" ? at - bt : bt - at;
      }
      if (key === "amortization_months") {
        const an = Number(a.amortization_months ?? 0);
        const bn = Number(b.amortization_months ?? 0);
        return dir === "asc" ? an - bn : bn - an;
      }
      const av = a[key];
      const bv = b[key];
      const as = String(av ?? "").trim();
      const bs = String(bv ?? "").trim();
      const cmp = as.localeCompare(bs, "zh-Hant");
      return dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sort]);

  const toggleSort = useCallback((key: MaterialSortKey) => {
    setSort((prev) => {
      if (prev.key !== key) {
        return { key, dir: "asc" };
      }
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }, []);

  const SortHeader = useCallback(
    ({ label, colKey }: { label: string; colKey: MaterialSortKey }) => {
      const active = sort.key === colKey;
      return (
        <button
          type="button"
          onClick={() => toggleSort(colKey)}
          className="inline-flex items-center gap-1 text-xs font-semibold p-2 align-middle hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded"
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
    },
    [sort, toggleSort],
  );

  async function performDelete() {
    if (!deleteRow) return;
    const id = deleteRow.id;
    setDeleteRow(null);
    const { error } = await supabase.from("procurement_materials").delete().eq("id", id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除物料");
    fetchMaterials();
  }

  async function performCopy() {
    if (!copyRow) return;
    const row = copyRow;
    setCopyRow(null);
    const base = row.name.trim();
    const payloadBase = {
      item_category: row.item_category?.trim() || null,
      spec: row.spec?.trim() || null,
      spec2: row.spec2?.trim() || null,
      unit: row.unit?.trim() || null,
      notes: row.notes?.trim() || null,
      amortization_months: row.amortization_months ?? null,
    };
    for (let n = 0; n < 25; n++) {
      const name = n === 0 ? `${base} (複製)` : `${base} (複製 ${n + 1})`;
      const { error } = await supabase.from("procurement_materials").insert({ name, ...payloadBase });
      if (!error) {
        toast.success("已複製物料");
        fetchMaterials();
        return;
      }
      if (!/duplicate|23505|unique/i.test(String(error.message))) {
        toast.error(error.message || "複製失敗");
        return;
      }
    }
    toast.error("無法產生不重複品名，請稍後再試或手動新增");
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground" role="status">
        載入物料主檔中…
      </div>
    );
  }

  const emptyMessage =
    records.length === 0
      ? "尚無物料主檔，請新增"
      : "無符合篩選或搜尋的物料";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          採購時由此選取標準品名，可統計並避免同義異體字。共 {records.length} 筆
        </p>
        <Button type="button" className="h-9 shrink-0" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          新增物料
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="flex min-w-[10rem] flex-col gap-1.5 sm:max-w-[14rem]">
          <label htmlFor="material-filter-category" className="text-xs text-muted-foreground">
            篩選類別
          </label>
          <select
            id="material-filter-category"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依物品類別篩選"
          >
            <option value="">全部類別</option>
            {hasUncategorized ? (
              <option value={FILTER_UNCATEGORIZED}>（未分類）</option>
            ) : null}
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋品名、類別、規格、規格2、單位、備註…"
            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="搜尋物料"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="p-2 align-middle">
                <SortHeader label="標準品名" colKey="name" />
              </TableHead>
              <TableHead className="p-2 align-middle">
                <SortHeader label="類別" colKey="item_category" />
              </TableHead>
              <TableHead className="p-2 align-middle">
                <SortHeader label="規格" colKey="spec" />
              </TableHead>
              <TableHead className="p-2 align-middle">
                <SortHeader label="規格2" colKey="spec2" />
              </TableHead>
              <TableHead className="p-2 align-middle">
                <SortHeader label="預設單位" colKey="unit" />
              </TableHead>
              <TableHead className="p-2 align-middle">
                <SortHeader label="預設攤提" colKey="amortization_months" />
              </TableHead>
              <TableHead className="p-2 align-middle">
                <SortHeader label="建立" colKey="created_at" />
              </TableHead>
              <TableHead className="text-xs font-semibold p-2 w-[132px]" aria-label="操作">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground text-sm">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((r) => (
                <TableRow key={r.id} className="border-b border-border hover:bg-muted/30">
                  <TableCell className="text-sm p-2 font-medium">{r.name}</TableCell>
                  <TableCell className="text-sm p-2 text-muted-foreground">{r.item_category || "—"}</TableCell>
                  <TableCell className="text-sm p-2 text-muted-foreground">{r.spec || "—"}</TableCell>
                  <TableCell className="text-sm p-2 text-muted-foreground">{r.spec2 || "—"}</TableCell>
                  <TableCell className="text-sm p-2">{r.unit || "—"}</TableCell>
                  <TableCell className="text-sm p-2 text-muted-foreground whitespace-nowrap">
                    {formatAmortizationLabel(resolveDefaultAmortizationMonths(r))}
                  </TableCell>
                  <TableCell className="text-sm p-2 text-muted-foreground whitespace-nowrap">
                    {r.created_at ? formatDate(r.created_at) : "—"}
                  </TableCell>
                  <TableCell className="p-2">
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCopyRow(r)} aria-label={`複製 ${r.name}`}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditRow(r)} aria-label={`編輯 ${r.name}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteRow(r)} aria-label={`刪除 ${r.name}`}>
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

      <AddMaterialDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          void fetchMaterials();
        }}
      />

      <EditMaterialDialog
        open={editRow != null}
        onOpenChange={(o) => !o && setEditRow(null)}
        row={editRow}
        onSaved={fetchMaterials}
      />

      <ConfirmDialog
        open={copyRow != null}
        onOpenChange={(open) => !open && setCopyRow(null)}
        title="是否複製此筆採購物料？"
        description={
          copyRow ? (
            <>
              <p className="font-medium text-foreground">{copyRow.name}</p>
              <p className="mt-2 text-muted-foreground text-sm">
                將新增一筆內容相同的物料，品名會自動加上「(複製)」後綴（若已存在則改為「(複製 2)」等），不影響原資料與既有採購明細。
              </p>
            </>
          ) : null
        }
        confirmLabel="確定複製"
        onConfirm={performCopy}
      />

      <ConfirmDialog
        open={deleteRow != null}
        onOpenChange={(open) => !open && setDeleteRow(null)}
        title="是否確定刪除此筆採購物料？"
        description={
          deleteRow ? (
            <>
              <p className="font-medium text-foreground">{deleteRow.name}</p>
              <p className="mt-2 text-muted-foreground text-sm">已關聯採購明細的 material_id 會改為空。若採購單仍顯示品名，為當時快照文字。</p>
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
