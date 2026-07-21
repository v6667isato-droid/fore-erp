"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const ERR_ZH: Record<string, string> = {
  forbidden: "僅管理員可補登加班。",
  invalid_hours: "請輸入大於 0 的加班時數。",
  employee_not_found: "找不到有效員工。",
  already_exists: "該員此日已有加班紀錄（已轉補休），如需修改請先於資料庫刪除原紀錄。",
};

type RpcPayload = { ok?: boolean; error?: string };

const inputClass =
  "mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

function todayIso(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/**
 * 手動補登加班：出差、外勤等未在公司打卡的加班，先寫入 overtime_records
 * 並累加補休金庫；薪資結算會自動帶入該月加班時數（屆時可選轉補休或加班費）。
 */
export function ManualOvertimeDialog({
  open,
  onOpenChange,
  employees,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [dateIso, setDateIso] = useState(todayIso);
  const [hoursInput, setHoursInput] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmployeeId("");
    setDateIso(todayIso());
    setHoursInput("");
    setReason("");
  }, [open]);

  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")),
    [employees],
  );

  async function handleSubmit() {
    if (!employeeId) {
      toast.error("請選擇員工。");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
      toast.error("請選擇日期。");
      return;
    }
    const hours = Number(String(hoursInput).replace(",", "."));
    if (!Number.isFinite(hours) || hours <= 0) {
      toast.error("請輸入有效的加班時數（大於 0）。");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("approve_overtime_to_comp_leave", {
        p_employee_id: employeeId,
        p_hours: hours,
        p_overtime_date: dateIso,
        p_reason: reason.trim(),
      });

      if (error) {
        toast.error(error.message || "補登失敗");
        return;
      }

      const payload = data as RpcPayload | null;
      if (payload && payload.ok === false) {
        const code = typeof payload.error === "string" ? payload.error : "";
        toast.error((ERR_ZH[code] ?? code) || "補登失敗");
        return;
      }

      toast.success("已補登加班並轉入補休金庫。");
      onSaved();
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
            手動補登加班（轉入補休金庫）
          </Dialog.Title>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            適用出差、外勤等未在公司打卡的加班（例：假日出差）。補登後立即累加補休金庫，
            薪資結算會自動帶入該月加班時數，屆時可選擇轉補休或加班費，無須再手動加減。
          </p>

          <div className="mt-4">
            <label htmlFor="manual-ot-employee" className="text-sm font-medium text-foreground">
              員工
            </label>
            <select
              id="manual-ot-employee"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={inputClass}
            >
              <option value="">請選擇員工…</option>
              {sortedEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3">
            <label htmlFor="manual-ot-date" className="text-sm font-medium text-foreground">
              加班日期
            </label>
            <input
              id="manual-ot-date"
              type="date"
              value={dateIso}
              onChange={(e) => setDateIso(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="mt-3">
            <label htmlFor="manual-ot-hours" className="text-sm font-medium text-foreground">
              核定加班時數（小時）
            </label>
            <input
              id="manual-ot-hours"
              type="number"
              min={0.01}
              step={0.1}
              value={hoursInput}
              onChange={(e) => setHoursInput(e.target.value)}
              placeholder="例：8"
              className={inputClass}
            />
          </div>

          <div className="mt-3">
            <label htmlFor="manual-ot-reason" className="text-sm font-medium text-foreground">
              備註事由（選填）
            </label>
            <input
              id="manual-ot-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例：假日出差、展場支援…"
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
              disabled={submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  處理中…
                </>
              ) : (
                "確認補登並轉入金庫"
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
