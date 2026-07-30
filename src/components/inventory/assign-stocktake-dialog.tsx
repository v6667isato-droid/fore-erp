"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X, Search } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PART_CATEGORIES, type EmployeeOption } from "@/types/inventory";

type ScopeMode = "all" | "category" | "custom";

interface PickerPart {
  id: string;
  name: string;
  category: string;
  /** 零件名稱已不含系列前綴，顯示用系列名稱補上（null＝共用） */
  series_name: string | null;
}

export interface AssignStocktakeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 指派盤點交辦：任務出現在該員工儀表板的「交辦事項」，點開即盤點視窗 */
export function AssignStocktakeDialog({ open, onOpenChange }: AssignStocktakeDialogProps) {
  const [assigneeId, setAssigneeId] = useState("");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [category, setCategory] = useState<string>(PART_CATEGORIES[0]);
  const [selectedPartIds, setSelectedPartIds] = useState<Set<string>>(new Set());
  const [partSearch, setPartSearch] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [parts, setParts] = useState<PickerPart[]>([]);

  useEffect(() => {
    if (!open) return;
    setAssigneeId("");
    setScopeMode("all");
    setCategory(PART_CATEGORIES[0]);
    setSelectedPartIds(new Set());
    setPartSearch("");
    setDueDate("");
    setInstructions("");
    setError(null);
    let cancelled = false;
    void (async () => {
      const [empRes, partsRes] = await Promise.all([
        supabase
          .from("employees")
          .select("id, name")
          .is("deleted_at", null)
          .or("employment_status.is.null,employment_status.eq.true")
          .order("name"),
        supabase
          .from("parts")
          .select("id, name, category, product_series(series_name)")
          .is("deleted_at", null)
          .order("name"),
      ]);
      if (cancelled) return;
      setEmployees((empRes.data as EmployeeOption[]) ?? []);
      const rows = (
        ((partsRes.data ?? []) as unknown) as {
          id: string;
          name: string;
          category: string;
          product_series: { series_name: string } | null;
        }[]
      ).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        series_name: p.product_series?.series_name ?? null,
      }));
      rows.sort((a, b) => {
        const s = (a.series_name ?? "").localeCompare(b.series_name ?? "", "zh-Hant");
        return s !== 0 ? s : a.name.localeCompare(b.name, "zh-Hant");
      });
      setParts(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const visiblePickerParts = useMemo(() => {
    const q = partSearch.trim().toLowerCase();
    if (!q) return parts;
    return parts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.series_name ?? "").toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    );
  }, [parts, partSearch]);

  function togglePart(id: string, checked: boolean) {
    setSelectedPartIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** 勾選/取消目前搜尋結果的全部零件 */
  function toggleVisible(checked: boolean) {
    setSelectedPartIds((prev) => {
      const next = new Set(prev);
      for (const p of visiblePickerParts) {
        if (checked) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!assigneeId) {
      setError("請選擇指派員工");
      return;
    }
    if (scopeMode === "custom" && selectedPartIds.size === 0) {
      setError("自選零件模式請至少勾選一顆零件");
      return;
    }
    setSaving(true);
    const { error: err } = await supabase.from("stocktake_tasks").insert({
      assignee_id: assigneeId,
      category: scopeMode === "category" ? category : null,
      part_ids: scopeMode === "custom" ? [...selectedPartIds] : null,
      due_date: dueDate || null,
      instructions: instructions.trim() || null,
    });
    setSaving(false);
    if (err) {
      setError(err.message || "指派失敗");
      toast.error(err.message || "指派失敗");
      return;
    }
    const empName = employees.find((emp) => emp.id === assigneeId)?.name ?? "";
    toast.success(`已指派盤點給 ${empName}，將出現在其儀表板交辦事項`);
    onOpenChange(false);
  }

  const inputCls =
    "h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  const allVisibleSelected =
    visiblePickerParts.length > 0 && visiblePickerParts.every((p) => selectedPartIds.has(p.id));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[60] flex max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="assign-stocktake-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">指派盤點</Dialog.Title>
              <p id="assign-stocktake-desc" className="mt-1 text-sm text-muted-foreground">
                任務會出現在該員工儀表板的「交辦事項」，點「開始盤點」即開啟盤點視窗；寫入結果後自動完成。
              </p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="assign-st-employee" className="text-xs text-muted-foreground">指派員工 *</label>
                <select id="assign-st-employee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputCls} required>
                  <option value="">選擇員工…</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="assign-st-due" className="text-xs text-muted-foreground">期限</label>
                <input id="assign-st-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">盤點範圍</span>
              <div className="inline-flex flex-wrap rounded-lg border border-border bg-muted/30 p-1">
                {(
                  [
                    { id: "all" as const, label: "全部零件" },
                    { id: "category" as const, label: "依分類" },
                    { id: "custom" as const, label: "自選零件" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={scopeMode === m.id}
                    onClick={() => setScopeMode(m.id)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      scopeMode === m.id
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {scopeMode === "category" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="assign-st-category" className="text-xs text-muted-foreground">分類</label>
                <select id="assign-st-category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                  {PART_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}

            {scopeMode === "custom" && (
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden />
                    <input
                      type="search"
                      value={partSearch}
                      onChange={(e) => setPartSearch(e.target.value)}
                      placeholder="搜尋名稱、系列、分類…"
                      className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      aria-label="搜尋零件"
                    />
                  </div>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(e) => toggleVisible(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-input accent-[var(--primary)]"
                    />
                    全選目前結果
                  </label>
                </div>
                <div className="max-h-48 overflow-y-auto rounded-md border border-border/60">
                  {visiblePickerParts.length === 0 ? (
                    <p className="p-4 text-center text-sm text-muted-foreground">
                      {parts.length === 0 ? "尚無零件" : "無符合搜尋的零件"}
                    </p>
                  ) : (
                    <ul>
                      {visiblePickerParts.map((p) => (
                        <li key={p.id} className="border-b border-border/60 last:border-b-0">
                          <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/30">
                            <input
                              type="checkbox"
                              checked={selectedPartIds.has(p.id)}
                              onChange={(e) => togglePart(p.id, e.target.checked)}
                              className="h-4 w-4 shrink-0 rounded border-input accent-[var(--primary)]"
                            />
                            <span className="shrink-0 font-medium">{p.series_name ?? "共用"}</span>
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{p.category}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">已勾選 {selectedPartIds.size} 顆零件</p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="assign-st-notes" className="text-xs text-muted-foreground">說明</label>
              <textarea
                id="assign-st-notes"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={2}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="選填，例如：只數倉庫架上的料，工作區備好的不算"
              />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={saving}>取消</Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>{saving ? "指派中…" : "指派"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
