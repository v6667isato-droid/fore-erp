"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { MAX_PROMPT_RULES } from "@/lib/intake-learning";
import { Button } from "@/components/ui/button";

interface IntakeRuleRow {
  id: string;
  rule: string;
  source_kind: string;
  source_excerpt: string | null;
  created_at: string;
}

export interface IntakeRulesDialogProps {
  /** 呼叫端在開啟時才掛載（每次開啟重新讀取） */
  onClose: () => void;
  /** 管理員可刪除規則（RLS 同樣限制） */
  canManage?: boolean;
  /** 規則數變動（刪除後）通知呼叫端更新計數 */
  onChanged?: () => void;
}

/** 貼上建立：員工修正後 AI 學到的規則清單（解析時帶入最新的 MAX_PROMPT_RULES 條） */
export function IntakeRulesDialog({ onClose, canManage = false, onChanged }: IntakeRulesDialogProps) {
  /** null＝讀取中 */
  const [rows, setRows] = useState<IntakeRuleRow[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("intake_learning_rules")
        .select("id, rule, source_kind, source_excerpt, created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) toast.error(error.message || "讀取規則失敗");
      setRows((data ?? []) as IntakeRuleRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function remove(row: IntakeRuleRow) {
    if (!window.confirm(`刪除這條規則？之後解析不會再套用。\n\n${row.rule}`)) return;
    setDeletingId(row.id);
    const { data, error } = await supabase
      .from("intake_learning_rules")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", row.id)
      .select("id");
    setDeletingId(null);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    // RLS 擋下時不會報錯、只是沒有更新任何一筆
    if (!data || data.length === 0) {
      toast.error("只有管理員可以刪除規則");
      return;
    }
    setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id));
    onChanged?.();
  }

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[60] max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-lg focus:outline-none sm:p-5"
          aria-describedby="intake-rules-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-foreground">AI 學到的規則</Dialog.Title>
              <p id="intake-rules-desc" className="mt-1 text-sm text-muted-foreground">
                員工修正貼上建立的結果並儲存後，AI 會把「讀錯的地方」整理成一句規則，之後解析時一併參考（最新 {MAX_PROMPT_RULES} 條）。
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 space-y-2">
            {rows == null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                讀取中…
              </p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">還沒有學到任何規則。</p>
            ) : (
              rows.map((row, i) => (
                <div
                  key={row.id}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                    i < MAX_PROMPT_RULES ? "border-border bg-card" : "border-dashed border-border opacity-60"
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm text-foreground [overflow-wrap:anywhere]">{row.rule}</p>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {row.created_at.slice(0, 10)}・{row.source_kind === "customer" ? "客戶欄位" : "訂單內容"}
                      {i >= MAX_PROMPT_RULES ? "・超過上限，目前未套用" : ""}
                    </p>
                    {row.source_excerpt ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground/80 [overflow-wrap:anywhere]">
                        來源：{row.source_excerpt}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => void remove(row)}
                      disabled={deletingId === row.id}
                      aria-label="刪除規則"
                      title="刪除規則"
                    >
                      {deletingId === row.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </div>
          {!canManage && rows != null && rows.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">如有規則學錯，請管理員刪除。</p>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
