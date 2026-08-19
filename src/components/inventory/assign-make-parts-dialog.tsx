"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X, Plus, Trash2 } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { EmployeeOption } from "@/types/inventory";
import type { PartMakeTaskItem } from "@/lib/part-make-tasks";
import type { Json } from "@/types/database.types";

/** 製作對象＝庫存變體（part_variant_stock_status 一列） */
interface PickerVariant {
  id: string;
  part_id: string;
  sku: string;
  name: string;
  material_name: string | null;
  unit: string;
  source_type: string;
}

interface DraftItem {
  variant_id: string;
  quantity: string;
}

export interface AssignMakePartsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 指派製作零件：任務出現在員工儀表板交辦事項，完成回報時自動寫「進料」入庫 */
export function AssignMakePartsDialog({ open, onOpenChange }: AssignMakePartsDialogProps) {
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [items, setItems] = useState<DraftItem[]>([{ variant_id: "", quantity: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [variants, setVariants] = useState<PickerVariant[]>([]);

  useEffect(() => {
    if (!open) return;
    setAssigneeId("");
    setDueDate("");
    setInstructions("");
    setItems([{ variant_id: "", quantity: "" }]);
    setError(null);
    let cancelled = false;
    void (async () => {
      const [empRes, variantsRes] = await Promise.all([
        supabase
          .from("employees")
          .select("id, name")
          .is("deleted_at", null)
          .or("employment_status.is.null,employment_status.eq.true")
          .order("name"),
        supabase
          .from("part_variant_stock_status")
          .select("id, part_id, sku, name, material_name, unit, source_type")
          .order("sku"),
      ]);
      if (cancelled) return;
      setEmployees((empRes.data as EmployeeOption[]) ?? []);
      // 自製零件排前面（製作交辦幾乎都是自製件）
      const list = ((((variantsRes.data ?? []) as unknown) as PickerVariant[])).slice();
      list.sort((a, b) => {
        if (a.source_type !== b.source_type) return a.source_type === "自製" ? -1 : 1;
        return a.sku.localeCompare(b.sku);
      });
      setVariants(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const variantMap = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!assigneeId) {
      setError("請選擇指派員工");
      return;
    }
    const cleaned = items
      .map((it) => ({ variant_id: it.variant_id, qty: Number(it.quantity) }))
      .filter((it) => it.variant_id !== "");
    if (cleaned.length === 0) {
      setError("請至少加入一項零件");
      return;
    }
    if (cleaned.some((it) => !Number.isFinite(it.qty) || it.qty <= 0)) {
      setError("每項零件的預計製作數量必須大於 0");
      return;
    }
    const seen = new Set<string>();
    for (const it of cleaned) {
      if (seen.has(it.variant_id)) {
        setError("同一顆零件重複出現，請合併為一列");
        return;
      }
      seen.add(it.variant_id);
    }
    // 快照沿用 part_no/name/unit 鍵供既有顯示相容：part_no＝sku、name 含材質
    const snapshot: PartMakeTaskItem[] = cleaned.map((it) => {
      const v = variantMap.get(it.variant_id);
      return {
        part_id: v?.part_id ?? "?",
        part_variant_id: it.variant_id,
        part_no: v?.sku ?? "?",
        name: v ? `${v.name}${v.material_name ? `・${v.material_name}` : ""}` : "?",
        unit: v?.unit ?? "",
        quantity: it.qty,
      };
    });
    setSaving(true);
    const { error: err } = await supabase.from("part_make_tasks").insert({
      assignee_id: assigneeId,
      items: snapshot as unknown as Json,
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
    toast.success(`已指派製作給 ${empName}，將出現在其儀表板交辦事項`);
    onOpenChange(false);
  }

  const inputCls =
    "h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="assign-make-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">指派製作零件</Dialog.Title>
              <p id="assign-make-desc" className="mt-1 text-sm text-muted-foreground">
                任務會出現在該員工儀表板的「交辦事項」；填入的數量為預計製作數量，完成回報時依實際完成量自動入庫（進料）。
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
                <label htmlFor="assign-mk-employee" className="text-xs text-muted-foreground">指派員工 *</label>
                <select id="assign-mk-employee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputCls} required>
                  <option value="">選擇員工…</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="assign-mk-due" className="text-xs text-muted-foreground">期限</label>
                <input id="assign-mk-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">製作項目</p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  onClick={() => setItems((prev) => [...prev, { variant_id: "", quantity: "" }])}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  加一列
                </Button>
              </div>
              {items.map((it, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={it.variant_id}
                    onChange={(e) => updateItem(idx, { variant_id: e.target.value })}
                    className={cn(inputCls, "min-w-0 flex-1")}
                    aria-label={`第 ${idx + 1} 列零件`}
                  >
                    <option value="">選擇零件…</option>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.sku}｜{v.name}{v.material_name ? `・${v.material_name}` : ""}{v.source_type === "自製" ? "" : "（採購件）"}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                    className={cn(inputCls, "w-24 text-right")}
                    placeholder="預計數量"
                    aria-label={`第 ${idx + 1} 列預計製作數量`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={items.length === 1}
                    aria-label={`移除第 ${idx + 1} 列`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="assign-mk-notes" className="text-xs text-muted-foreground">說明</label>
              <textarea
                id="assign-mk-notes"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={2}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="選填，例如：先做椅腳，圖面見零件主檔尺寸圖"
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
