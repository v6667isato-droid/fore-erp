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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PartDialog } from "@/components/inventory/part-dialog";
import { StockMovementDialog } from "@/components/inventory/stock-movement-dialog";
import { StocktakeDialog } from "@/components/inventory/stocktake-dialog";
import { AssignStocktakeDialog } from "@/components/inventory/assign-stocktake-dialog";
import { AssignMakePartsDialog } from "@/components/inventory/assign-make-parts-dialog";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ArrowLeftRight,
  ExternalLink,
  AlertTriangle,
  ClipboardList,
  UserPlus,
  Copy,
  Hammer,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PART_CATEGORIES, formatPartDimensions, type PartRow, type PartStockInfo, type PartWithStock } from "@/types/inventory";

type PartSortKey = "part_no" | "name" | "category" | "procurement_type" | "current_stock" | "safety_stock" | "reorder_point";

export interface PartsTabProps {
  isAdmin?: boolean;
}

export function PartsTab({ isAdmin = false }: PartsTabProps) {
  const [records, setRecords] = useState<PartWithStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [onlyNeedsReorder, setOnlyNeedsReorder] = useState(false);
  const [sort, setSort] = useState<{ key: PartSortKey; dir: "asc" | "desc" }>({
    key: "part_no",
    dir: "asc",
  });
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<PartRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<PartWithStock | null>(null);
  const [movementRow, setMovementRow] = useState<PartWithStock | null>(null);
  const [stocktakeOpen, setStocktakeOpen] = useState(false);
  const [assignStocktakeOpen, setAssignStocktakeOpen] = useState(false);
  const [assignMakeOpen, setAssignMakeOpen] = useState(false);
  const [copyRow, setCopyRow] = useState<PartRow | null>(null);
  const [filterSpecies, setFilterSpecies] = useState("");

  const fetchParts = useCallback(async () => {
    setLoading(true);
    const [partsRes, stockRes, vendorsRes] = await Promise.all([
      supabase
        .from("parts")
        .select(
          "id, part_no, name, category, unit, procurement_type, source_type, wood_species, safety_stock, reorder_point, vendor_id, reference_unit_price, drawing_url, dim_length_mm, dim_width_mm, dim_thickness_mm, sop, is_component, notes, created_at",
        )
        .is("deleted_at", null)
        .order("part_no"),
      supabase.from("part_stock_status").select("id, current_stock, needs_reorder, below_safety"),
      supabase.from("vendors").select("id, name").is("deleted_at", null),
    ]);
    setLoading(false);
    if (partsRes.error || stockRes.error) {
      toast.error(partsRes.error?.message || stockRes.error?.message || "無法載入零件");
      setRecords([]);
      return;
    }
    const stockMap = new Map<string, PartStockInfo>();
    for (const s of stockRes.data ?? []) {
      if (s.id) {
        stockMap.set(s.id, {
          current_stock: Number(s.current_stock ?? 0),
          needs_reorder: Boolean(s.needs_reorder),
          below_safety: Boolean(s.below_safety),
        });
      }
    }
    const vendorMap = new Map<string, string>();
    for (const v of vendorsRes.data ?? []) vendorMap.set(v.id, v.name);
    const merged: PartWithStock[] = ((partsRes.data as PartRow[]) ?? []).map((p) => ({
      ...p,
      current_stock: stockMap.get(p.id)?.current_stock ?? 0,
      needs_reorder: stockMap.get(p.id)?.needs_reorder ?? false,
      below_safety: stockMap.get(p.id)?.below_safety ?? false,
      vendor_name: p.vendor_id ? (vendorMap.get(p.vendor_id) ?? null) : null,
    }));
    setRecords(merged);
  }, []);

  useEffect(() => {
    void fetchParts();
  }, [fetchParts]);

  const reorderCount = useMemo(() => records.filter((r) => r.needs_reorder).length, [records]);

  const speciesOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      const s = r.wood_species?.trim();
      if (s) set.add(s);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [records]);

  const filtered = useMemo(() => {
    let list = records;
    if (filterCategory) list = list.filter((r) => r.category === filterCategory);
    if (filterSpecies) list = list.filter((r) => (r.wood_species || "").trim() === filterSpecies);
    if (onlyNeedsReorder) list = list.filter((r) => r.needs_reorder);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.part_no.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.wood_species || "").toLowerCase().includes(q) ||
        (r.vendor_name || "").toLowerCase().includes(q) ||
        (r.notes || "").toLowerCase().includes(q),
    );
  }, [records, filterCategory, filterSpecies, onlyNeedsReorder, search]);

  const sortedRows = useMemo(() => {
    const list = [...filtered];
    const { key, dir } = sort;
    list.sort((a, b) => {
      if (key === "current_stock" || key === "safety_stock" || key === "reorder_point") {
        const an = Number(a[key] ?? 0);
        const bn = Number(b[key] ?? 0);
        return dir === "asc" ? an - bn : bn - an;
      }
      const cmp = String(a[key] ?? "").localeCompare(String(b[key] ?? ""), "zh-Hant");
      return dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sort]);

  const toggleSort = useCallback((key: PartSortKey) => {
    setSort((prev) =>
      prev.key !== key ? { key, dir: "asc" } : { key, dir: prev.dir === "asc" ? "desc" : "asc" },
    );
  }, []);

  const SortHeader = useCallback(
    ({ label, colKey }: { label: string; colKey: PartSortKey }) => {
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
    const { error } = await supabase
      .from("parts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    toast.success("已刪除零件");
    void fetchParts();
  }

  // 只在首次載入時整頁顯示載入中；重抓（存檔後刷新）保留表格與已掛載的 dialog，
  // 否則存檔後的「同步到其他材種」確認視窗會隨元件卸載而消失
  if (loading && records.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground" role="status">
        載入零件主檔中…
      </div>
    );
  }

  const emptyMessage = records.length === 0 ? "尚無零件，請新增" : "無符合篩選或搜尋的零件";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          目前庫存由庫存異動紀錄加總計算。共 {records.length} 顆零件
          {reorderCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyNeedsReorder((v) => !v)}
              className={cn(
                "ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
                onlyNeedsReorder
                  ? "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400",
              )}
              aria-pressed={onlyNeedsReorder}
            >
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {reorderCount} 顆待補貨
            </button>
          )}
        </p>
        {isAdmin && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-9" onClick={() => setAssignMakeOpen(true)} disabled={records.length === 0}>
              <Hammer className="h-4 w-4 mr-1.5" />
              指派製作
            </Button>
            <Button type="button" variant="outline" className="h-9" onClick={() => setAssignStocktakeOpen(true)} disabled={records.length === 0}>
              <UserPlus className="h-4 w-4 mr-1.5" />
              指派盤點
            </Button>
            <Button type="button" variant="outline" className="h-9" onClick={() => setStocktakeOpen(true)} disabled={records.length === 0}>
              <ClipboardList className="h-4 w-4 mr-1.5" />
              盤點模式
            </Button>
            <Button type="button" className="h-9" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              新增零件
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="flex min-w-[10rem] flex-col gap-1.5 sm:max-w-[14rem]">
          <label htmlFor="part-filter-category" className="text-xs text-muted-foreground">篩選分類</label>
          <select
            id="part-filter-category"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="依零件分類篩選"
          >
            <option value="">全部分類</option>
            {PART_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        {speciesOptions.length > 0 && (
          <div className="flex min-w-[9rem] flex-col gap-1.5 sm:max-w-[12rem]">
            <label htmlFor="part-filter-species" className="text-xs text-muted-foreground">篩選材種</label>
            <select
              id="part-filter-species"
              value={filterSpecies}
              onChange={(e) => setFilterSpecies(e.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="依材種篩選"
            >
              <option value="">全部材種</option>
              {speciesOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋料號、名稱、供應商、備註…"
            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="搜尋零件"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="p-2 align-middle"><SortHeader label="料號" colKey="part_no" /></TableHead>
              <TableHead className="p-2 align-middle"><SortHeader label="名稱" colKey="name" /></TableHead>
              <TableHead className="p-2 align-middle"><SortHeader label="分類" colKey="category" /></TableHead>
              <TableHead className="text-xs font-semibold p-2">尺寸 (mm)</TableHead>
              <TableHead className="p-2 align-middle"><SortHeader label="採購型態" colKey="procurement_type" /></TableHead>
              <TableHead className="p-2 align-middle text-right"><SortHeader label="目前庫存" colKey="current_stock" /></TableHead>
              <TableHead className="p-2 align-middle text-right"><SortHeader label="安全庫存" colKey="safety_stock" /></TableHead>
              <TableHead className="p-2 align-middle text-right"><SortHeader label="發注點" colKey="reorder_point" /></TableHead>
              <TableHead className="text-xs font-semibold p-2">供應商</TableHead>
              <TableHead className="text-xs font-semibold p-2">尺寸圖</TableHead>
              <TableHead className="text-xs font-semibold p-2 w-[132px]" aria-label="操作">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-24 text-center text-muted-foreground text-sm">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((r) => (
                <TableRow key={r.id} className="border-b border-border hover:bg-muted/30">
                  <TableCell className="text-sm p-2 font-medium whitespace-nowrap">{r.part_no}</TableCell>
                  <TableCell className="text-sm p-2">
                    {r.name}
                    {r.source_type === "自製" && (
                      <span className="ml-1.5 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-700 dark:text-blue-400 align-middle">自製</span>
                    )}
                    {r.is_component && (
                      <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground align-middle">組件</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm p-2 text-muted-foreground whitespace-nowrap">
                    {r.category}
                    {r.wood_species && <span className="text-xs">・{r.wood_species}</span>}
                  </TableCell>
                  <TableCell className="text-sm p-2 text-muted-foreground whitespace-nowrap tabular-nums">
                    {formatPartDimensions(r) ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm p-2 text-muted-foreground">{r.procurement_type}</TableCell>
                  <TableCell className="text-sm p-2 text-right whitespace-nowrap">
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        r.needs_reorder ? "text-destructive" : r.below_safety ? "text-amber-600 dark:text-amber-400" : "",
                      )}
                    >
                      {r.current_stock}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">{r.unit}</span>
                    {r.needs_reorder && (
                      <AlertTriangle
                        className="ml-1 inline h-3.5 w-3.5 text-destructive align-[-2px]"
                        aria-label={r.source_type === "自製" ? "低於發注點（排加工）" : "低於發注點（補貨）"}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-sm p-2 text-right tabular-nums text-muted-foreground">{r.safety_stock}</TableCell>
                  <TableCell className="text-sm p-2 text-right tabular-nums text-muted-foreground">{r.reorder_point}</TableCell>
                  <TableCell className="text-sm p-2 text-muted-foreground">{r.vendor_name || "—"}</TableCell>
                  <TableCell className="text-sm p-2">
                    {r.drawing_url ? (
                      <a
                        href={r.drawing_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        aria-label={`開啟 ${r.name} 尺寸圖`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        開啟
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="p-2">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setMovementRow(r)}
                        aria-label={`登錄 ${r.name} 庫存異動`}
                        title="庫存異動（進料／領用／盤點）"
                      >
                        <ArrowLeftRight className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCopyRow(r)}
                            aria-label={`複製 ${r.name}`}
                            title="複製零件（換材種時尺寸/SOP 免重打）"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditRow(r)} aria-label={`編輯 ${r.name}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteRow(r)} aria-label={`刪除 ${r.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <PartDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        row={null}
        onSaved={() => void fetchParts()}
      />

      <PartDialog
        open={editRow != null}
        onOpenChange={(o) => !o && setEditRow(null)}
        row={editRow}
        onSaved={() => void fetchParts()}
      />

      <PartDialog
        open={copyRow != null}
        onOpenChange={(o) => !o && setCopyRow(null)}
        row={null}
        copyFrom={copyRow}
        onSaved={() => void fetchParts()}
      />

      <StockMovementDialog
        open={movementRow != null}
        onOpenChange={(o) => !o && setMovementRow(null)}
        part={movementRow}
        onSaved={() => void fetchParts()}
      />

      <StocktakeDialog
        open={stocktakeOpen}
        onOpenChange={setStocktakeOpen}
        onSaved={() => void fetchParts()}
      />

      <AssignStocktakeDialog open={assignStocktakeOpen} onOpenChange={setAssignStocktakeOpen} />

      <AssignMakePartsDialog open={assignMakeOpen} onOpenChange={setAssignMakeOpen} />

      <ConfirmDialog
        open={deleteRow != null}
        onOpenChange={(open) => !open && setDeleteRow(null)}
        title="是否確定刪除此零件？"
        description={
          deleteRow ? (
            <>
              <p className="font-medium text-foreground">{deleteRow.part_no}｜{deleteRow.name}</p>
              <p className="mt-2 text-muted-foreground text-sm">
                為軟刪除：歷史庫存異動與整備工單紀錄保留，僅自主檔清單隱藏。
              </p>
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
