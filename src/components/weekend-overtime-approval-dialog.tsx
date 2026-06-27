"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { WarRoomRow } from "@/lib/attendance-war-room";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const ERR_ZH: Record<string, string> = {
  forbidden: "僅管理員可核准加班。",
  invalid_hours: "請輸入大於 0 的補休時數。",
  employee_not_found: "找不到有效員工。",
  already_exists: "此日已核准並轉入補休。",
};

type RpcPayload = { ok?: boolean; error?: string };

function overtimeApprovalDialogTitle(row: WarRoomRow | null): string {
  if (!row) return "";
  const wk = row.tags.some((t) => t.id === "weekend");
  const hwUnpaid = row.tags.some((t) => t.id === "holiday_work_unpaid");
  const hwPaid = row.tags.some((t) => t.id === "holiday_work");
  const hw = hwPaid || hwUnpaid;
  const hi = row.tags.some((t) => t.id === "hours_high");
  if ((wk || hw) && hi) return "核准加班並轉入補休金庫";
  if (hwUnpaid) return "核准無薪特殊假出勤並轉入補休金庫";
  if (hwPaid) return "核准國定假日出勤並轉入補休金庫";
  if (wk) return "核准假日加班並轉入補休金庫";
  if (hi) return "確認超時加班並轉入補休金庫";
  return "核准加班並轉入補休金庫";
}

const inputClass =
  "mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export function WeekendOvertimeApprovalDialog({
  open,
  onOpenChange,
  row,
  onApproved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: WarRoomRow | null;
  onApproved: () => void;
}) {
  const [hoursInput, setHoursInput] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    setHoursInput(row.hoursDay != null ? String(row.hoursDay) : "");
    setReason("");
  }, [open, row]);

  async function handleSubmit() {
    if (!row?.employeeId) {
      toast.error("無法核准：缺少員工對應（timeclock_uid）。");
      return;
    }
    const hours = Number(String(hoursInput).replace(",", "."));
    if (!Number.isFinite(hours) || hours <= 0) {
      toast.error("請輸入有效的補休時數（大於 0）。");
      return;
    }

    setSubmitting(true);
    try {
      // 參數名字母序對應 PostgREST 解析之型別序：(uuid, numeric, date, text)
      const { data, error } = await supabase.rpc("approve_overtime_to_comp_leave", {
        p_employee_id: row.employeeId,
        p_hours: hours,
        p_overtime_date: row.dateIso,
        p_reason: reason.trim(),
      });

      if (error) {
        toast.error(error.message || "核准失敗");
        return;
      }

      const payload = data as RpcPayload | null;
      if (payload && payload.ok === false) {
        const code = typeof payload.error === "string" ? payload.error : "";
        toast.error((ERR_ZH[code] ?? code) || "核准失敗");
        return;
      }

      toast.success("已核准並轉入補休金庫。");
      onApproved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[min(90vh,640px)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-lg focus:outline-none",
          )}
        >
          <Dialog.Title className="text-base font-semibold text-foreground">
            {overtimeApprovalDialogTitle(row)}
          </Dialog.Title>
          <p className="mt-1 text-xs text-muted-foreground">
            確認資料後核定補休時數；將寫入加班紀錄並累加員工補休餘額。
          </p>

          {row && (
            <div className="mt-4 space-y-3 rounded-lg border border-border/80 bg-muted/20 p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">員工</span>
                <span className="font-medium text-foreground">{row.employeeName}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">日期</span>
                <span className="tabular-nums text-foreground">{row.dateDisplay}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">上班</span>
                <span className="tabular-nums text-foreground">{row.clockIn ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">下班</span>
                <span className="tabular-nums text-foreground">{row.clockOut ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-2 border-t border-border/60 pt-2">
                <span className="text-muted-foreground">系統計算停留時數</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {row.hoursDay != null ? `${row.hoursDay} 小時` : "—"}
                </span>
              </div>
            </div>
          )}

          <div className="mt-4">
            <label htmlFor="comp-leave-hours" className="text-sm font-medium text-foreground">
              老闆核定補休時數（小時）
            </label>
            <input
              id="comp-leave-hours"
              type="number"
              min={0.01}
              step={0.1}
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="mt-3">
            <label htmlFor="comp-leave-reason" className="text-sm font-medium text-foreground">
              備註事由（選填）
            </label>
            <input
              id="comp-leave-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例：盤點支援、活動支援…"
              className={inputClass}
            />
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={submitting || !row}
              onClick={() => void handleSubmit()}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  處理中…
                </>
              ) : (
                "確認核准並轉入金庫"
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
