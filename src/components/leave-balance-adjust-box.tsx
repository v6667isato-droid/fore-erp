"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  formatHoursAsDayHour,
  formatSignedDayDecimalAsDayHour,
  LEAVE_WORK_DAY_HOURS,
} from "@/lib/employee-leave-time";
import { adjustLeaveBalanceRpc } from "@/lib/leave-balance-rpc";

/**
 * 員工資料（編輯）：特休／補休餘額唯讀，改以「調整」寫入異動紀錄（原因必填），
 * 並列入當月薪資單備註。新增員工時的起始餘額仍由表單欄位填寫。
 */
export function LeaveBalanceAdjustBox({
  employeeId,
  annualDays,
  compHours,
}: {
  employeeId: string;
  /** employees.annual_leave_remaining（天） */
  annualDays: number | null;
  /** employees.comp_leave_remaining（小時） */
  compHours: number | null;
}) {
  const [annual, setAnnual] = useState(annualDays);
  const [comp, setComp] = useState(compHours);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"annual" | "comp">("annual");
  const [direction, setDirection] = useState<"add" | "deduct">("add");
  const [days, setDays] = useState<number | null>(null);
  const [hours, setHours] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setDays(null);
    setHours(null);
    setNote("");
  }

  async function submit() {
    const total = (days ?? 0) * LEAVE_WORK_DAY_HOURS + (hours ?? 0);
    if (!(total > 0)) {
      toast.error("請輸入要調整的天數或小時。");
      return;
    }
    if (!note.trim()) {
      toast.error("請填寫調整原因。");
      return;
    }
    const delta = direction === "add" ? total : -total;
    const label = kind === "annual" ? "特休" : "補休";
    if (
      !window.confirm(
        `確定${direction === "add" ? "增加" : "扣除"}${label} ${formatHoursAsDayHour(total)}？\n原因：${note.trim()}\n會寫入異動紀錄並列入本月薪資單備註。`,
      )
    ) {
      return;
    }
    setSaving(true);
    const res = await adjustLeaveBalanceRpc(employeeId, kind, delta, note.trim());
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    const after = Number(res.data.balance_after_hours);
    if (kind === "annual") setAnnual(after / LEAVE_WORK_DAY_HOURS);
    else setComp(after);
    toast.success(`已調整${label}`);
    reset();
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border/80 bg-muted/20 px-3 py-2">
          <p className="text-xs text-muted-foreground">特休剩餘</p>
          <p className="tabular-nums text-sm font-medium text-foreground">
            {formatSignedDayDecimalAsDayHour(annual)}
          </p>
        </div>
        <div className="rounded-lg border border-border/80 bg-muted/20 px-3 py-2">
          <p className="text-xs text-muted-foreground">補休剩餘</p>
          <p className="tabular-nums text-sm font-medium text-foreground">
            {formatHoursAsDayHour(comp)}
          </p>
        </div>
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        餘額由假單核准、撤銷、颱風假回補、年資特休自動異動；其他情況請用「調整」並填寫原因，會列入當月薪資單備註。
      </p>
      {!open ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-8 px-3 text-xs" onClick={() => setOpen(true)}>
            調整特休／補休
          </Button>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-muted-foreground">
              假別
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value === "comp" ? "comp" : "annual")}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              >
                <option value="annual">特休</option>
                <option value="comp">補休</option>
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">
              增減
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value === "deduct" ? "deduct" : "add")}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              >
                <option value="add">增加</option>
                <option value="deduct">扣除</option>
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">
              日
              <NumericInput allowDecimal value={days} onValueChange={setDays} className="mt-1 w-full" />
            </label>
            <label className="block text-xs text-muted-foreground">
              小時
              <NumericInput allowDecimal value={hours} onValueChange={setHours} className="mt-1 w-full" />
            </label>
          </div>
          <label className="block text-xs text-muted-foreground">
            原因（必填）
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：更正誤植、入職約定補給"
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 px-3 text-xs"
              disabled={saving}
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              取消
            </Button>
            <Button type="button" className="h-8 px-3 text-xs" disabled={saving} onClick={() => void submit()}>
              {saving ? "處理中…" : "確定調整"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
