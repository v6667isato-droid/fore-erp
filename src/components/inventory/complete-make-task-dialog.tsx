"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { completePartMakeTask, type PartMakeTaskItem, type PartMakeTaskRow } from "@/lib/part-make-tasks";

/** 品項 key：同一任務可能有同零件不同材質變體，優先用 variant id 區分（舊快照退回 part_id） */
function itemKey(it: PartMakeTaskItem): string {
  return it.part_variant_id ?? it.part_id;
}

export interface CompleteMakeTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: PartMakeTaskRow | null;
  /** 回報人（入庫紀錄的經手人），通常為任務指派對象 */
  employeeId: string;
  onSaved?: () => void;
}

/** 製作交辦完成回報：逐項填實際完成量 → 寫「進料」入庫＋任務完成 */
export function CompleteMakeTaskDialog({
  open,
  onOpenChange,
  task,
  employeeId,
  onSaved,
}: CompleteMakeTaskDialogProps) {
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !task) return;
    const init: Record<string, string> = {};
    for (const it of task.items) init[itemKey(it)] = String(it.quantity);
    setActuals(init);
  }, [open, task]);

  async function onSubmit() {
    if (!task) return;
    const completions: { part_id: string; part_variant_id?: string | null; actual: number }[] = [];
    for (const it of task.items) {
      const n = Number(actuals[itemKey(it)] ?? "");
      if (!Number.isFinite(n) || n < 0) {
        toast.error(`「${it.name}」的完成數量需為 0 以上的數字`);
        return;
      }
      completions.push({ part_id: it.part_id, part_variant_id: it.part_variant_id ?? null, actual: n });
    }
    setSaving(true);
    const r = await completePartMakeTask({
      taskId: task.id,
      employeeId: employeeId || null,
      completions,
    });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    toast.success(
      r.movements > 0 ? `已回報完成，${r.movements} 項零件入庫` : "已回報完成（無入庫項目）",
    );
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="complete-make-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">製作完成回報</Dialog.Title>
              <p id="complete-make-desc" className="mt-1 text-sm text-muted-foreground">
                填實際完成的數量（可與預計數量不同），送出後自動入庫。做 0 顆的項目填 0。
              </p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {(task?.items ?? []).map((it) => (
              <div key={itemKey(it)} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {it.part_no}｜{it.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    預計 {it.quantity} {it.unit}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={actuals[itemKey(it)] ?? ""}
                    onChange={(e) =>
                      setActuals((a) => ({ ...a, [itemKey(it)]: e.target.value }))
                    }
                    className={cn(
                      "h-9 w-24 rounded-lg border border-input bg-background px-2 text-right text-sm",
                      "focus:outline-none focus:ring-2 focus:ring-ring",
                    )}
                    aria-label={`${it.name} 實際完成數量`}
                  />
                  <span className="text-xs text-muted-foreground">{it.unit}</span>
                </div>
              </div>
            ))}
          </div>

          {task?.instructions && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">說明：{task.instructions}</p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" disabled={saving}>取消</Button>
            </Dialog.Close>
            <Button type="button" disabled={saving} onClick={() => void onSubmit()}>
              {saving ? "入庫中…" : "回報完成並入庫"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
