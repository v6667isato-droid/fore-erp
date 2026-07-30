"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setStocktakeTaskCompleted } from "@/lib/stocktake-tasks";
import type { EmployeeOption } from "@/types/inventory";

/** 盤點列＝一個庫存變體（part_variant_stock_status 一列） */
interface StocktakeVariant {
  id: string;
  part_id: string;
  sku: string;
  name: string;
  material_name: string | null;
  unit: string;
  category: string;
  current_stock: number;
}

export interface StocktakeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /** 限定盤點分類（盤點交辦帶入）；空＝全部零件 */
  categoryFilter?: string | null;
  /** 自選盤點零件清單（盤點交辦帶入，邏輯零件 id）；非空時優先於 categoryFilter */
  partIds?: string[] | null;
  /** 預設盤點人（員工端開啟時帶入自己） */
  presetEmployeeId?: string;
  /** 盤點交辦任務 id；寫入盤點結果後自動標記任務完成 */
  taskId?: string;
}

/** 盤點模式：逐變體填實際數量，系統算差額批次寫入「盤點調整」；留空＝未盤、不異動 */
export function StocktakeDialog({
  open,
  onOpenChange,
  onSaved,
  categoryFilter,
  partIds,
  presetEmployeeId,
  taskId,
}: StocktakeDialogProps) {
  const [variants, setVariants] = useState<StocktakeVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setCounts({});
    setEmployeeId(presetEmployeeId ?? "");
    setSearch("");
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [variantsRes, empRes] = await Promise.all([
        supabase
          .from("part_variant_stock_status")
          .select("id, part_id, sku, name, material_name, unit, category, current_stock")
          .order("sku"),
        supabase
          .from("employees")
          .select("id, name")
          .is("deleted_at", null)
          .or("employment_status.is.null,employment_status.eq.true")
          .order("name"),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (variantsRes.error) {
        toast.error(variantsRes.error.message || "無法載入零件");
        setVariants([]);
        return;
      }
      // 交辦範圍是邏輯零件 id：指定零件時盤其全部變體
      const idSet = partIds && partIds.length > 0 ? new Set(partIds) : null;
      const rows = (((variantsRes.data ?? []) as unknown) as StocktakeVariant[])
        .map((v) => ({ ...v, current_stock: Number(v.current_stock ?? 0) }))
        .filter((v) => (idSet ? idSet.has(v.part_id) : !categoryFilter || v.category === categoryFilter));
      setVariants(rows);
      setEmployees((empRes.data as EmployeeOption[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, categoryFilter, partIds, presetEmployeeId]);

  const visibleVariants = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return variants;
    return variants.filter(
      (v) =>
        v.sku.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        (v.material_name ?? "").toLowerCase().includes(q),
    );
  }, [variants, search]);

  const pendingAdjustments = useMemo(() => {
    const list: { variant: StocktakeVariant; actual: number; diff: number }[] = [];
    for (const v of variants) {
      const raw = counts[v.id];
      if (raw == null || raw.trim() === "") continue;
      const actual = Number(raw);
      if (!Number.isFinite(actual) || actual < 0) continue;
      const diff = actual - v.current_stock;
      if (diff !== 0) list.push({ variant: v, actual, diff });
    }
    return list;
  }, [variants, counts]);

  const filledCount = useMemo(
    () => Object.values(counts).filter((v) => v.trim() !== "").length,
    [counts],
  );

  async function completeTask() {
    if (!taskId) return;
    const r = await setStocktakeTaskCompleted({ taskId, completed: true });
    if (!r.ok) toast.error(`盤點已寫入，但任務狀態更新失敗：${r.message}`);
  }

  async function onSubmit() {
    if (pendingAdjustments.length === 0) {
      toast.info("填入的實際數量都與帳面相符，無需調整");
      await completeTask();
      onSaved?.();
      onOpenChange(false);
      return;
    }
    setSaving(true);
    const payload = pendingAdjustments.map(({ variant, actual, diff }) => ({
      part_id: variant.part_id,
      part_variant_id: variant.id,
      movement_type: "盤點調整",
      quantity: diff,
      employee_id: employeeId || null,
      notes: `盤點：帳面 ${variant.current_stock} → 實際 ${actual}`,
    }));
    const { error } = await supabase.from("stock_movements").insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message || "盤點寫入失敗");
      return;
    }
    toast.success(`盤點完成，已調整 ${pendingAdjustments.length} 筆庫存`);
    await completeTask();
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[60] flex max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-card shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="stocktake-desc"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border p-5 pb-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                盤點模式
                {partIds && partIds.length > 0 ? (
                  <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground align-middle">
                    範圍：指定 {partIds.length} 顆零件
                  </span>
                ) : categoryFilter ? (
                  <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground align-middle">
                    範圍：{categoryFilter}
                  </span>
                ) : null}
              </Dialog.Title>
              <p id="stocktake-desc" className="mt-1 text-sm text-muted-foreground">
                填「實際數量」（現場數到的數字），系統自動算差額；留空的視為未盤、不異動。只數倉庫架上的料，已搬去工作區的不要算。
              </p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-wrap items-end gap-3 px-5 py-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋料號、名稱、材質…"
              className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="搜尋零件"
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="stocktake-employee" className="text-[11px] text-muted-foreground">盤點人</label>
              <select
                id="stocktake-employee"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">（未指定）</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5">
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground" role="status">載入零件中…</p>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left">
                    <th className="p-1.5 text-xs font-semibold text-muted-foreground sm:p-2">料號</th>
                    <th className="hidden p-2 text-xs font-semibold text-muted-foreground sm:table-cell">名稱</th>
                    <th className="hidden p-2 text-xs font-semibold text-muted-foreground sm:table-cell">材質</th>
                    <th className="whitespace-nowrap p-1.5 text-right text-xs font-semibold text-muted-foreground sm:p-2">帳面</th>
                    <th className="whitespace-nowrap p-1.5 text-right text-xs font-semibold text-muted-foreground sm:w-[110px] sm:p-2">實際數量</th>
                    <th className="whitespace-nowrap p-1.5 text-right text-xs font-semibold text-muted-foreground sm:w-[80px] sm:p-2">差額</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleVariants.map((v) => {
                    const raw = counts[v.id] ?? "";
                    const actual = raw.trim() === "" ? null : Number(raw);
                    const diff =
                      actual != null && Number.isFinite(actual) ? actual - v.current_stock : null;
                    return (
                      <tr key={v.id} className="border-b border-border">
                        <td className="p-1.5 text-sm font-medium sm:p-2">
                          <span className="whitespace-nowrap">{v.sku}</span>
                          <span className="mt-0.5 block max-w-[38vw] truncate text-xs font-normal text-muted-foreground sm:hidden">
                            {v.name}
                            {v.material_name ? `・${v.material_name}` : ""}
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap p-2 text-sm sm:table-cell">{v.name}</td>
                        <td className="hidden whitespace-nowrap p-2 text-sm text-muted-foreground sm:table-cell">
                          {v.material_name ?? "—"}
                        </td>
                        <td className="whitespace-nowrap p-1.5 text-right text-sm tabular-nums text-muted-foreground sm:p-2">
                          {v.current_stock} {v.unit}
                        </td>
                        <td className="p-1.5 text-right sm:p-2">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={raw}
                            onChange={(e) => setCounts((c) => ({ ...c, [v.id]: e.target.value }))}
                            className="h-8 w-16 rounded-lg border border-input bg-background px-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:w-24"
                            placeholder="未盤"
                            aria-label={`${v.name}${v.material_name ? `・${v.material_name}` : ""} 實際數量`}
                          />
                        </td>
                        <td className="whitespace-nowrap p-1.5 text-right text-sm tabular-nums sm:p-2">
                          {diff == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : diff === 0 ? (
                            <span className="text-muted-foreground">0</span>
                          ) : (
                            <span className={cn("font-medium", diff > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                              {diff > 0 ? `+${diff}` : diff}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleVariants.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                        {variants.length === 0 ? "沒有可盤點的零件" : "無符合搜尋的零件"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border p-5 pt-4">
            <p className="text-xs text-muted-foreground">
              已填 {filledCount} 筆，其中 {pendingAdjustments.length} 筆有差額
            </p>
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={saving}>取消</Button>
              </Dialog.Close>
              <Button type="button" disabled={saving || loading || filledCount === 0} onClick={() => void onSubmit()}>
                {saving ? "寫入中…" : "寫入盤點結果"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
