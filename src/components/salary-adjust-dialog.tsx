"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  cancelSalaryAdjustmentRpc,
  createSalaryAdjustmentRpc,
  currentTaipeiMonth,
  fetchLatestPaidMonth,
  fetchSalaryAdjustments,
  nextMonth,
  type SalaryAdjustment,
} from "@/lib/salary-adjustments";

export type SalaryAdjustTarget = {
  id: string;
  name: string;
  monthlyWage: number | null;
  laborInsuranceBracket: number | null;
  laborEmployeeBurden: number | null;
  healthEmployeeBurden: number | null;
};

function money(n: number | null | undefined): string {
  return n == null ? "—" : Math.round(n).toLocaleString("zh-TW");
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y} 年 ${Number(m)} 月`;
}

/** 可選的最早生效月份：最新已發放月份之後（沒有則本月），且須晚於最近一次調薪 */
function earliestMonth(history: readonly SalaryAdjustment[], latestPaid: string | null): string {
  const floor = latestPaid ? nextMonth(latestPaid) : currentTaipeiMonth();
  const lastAdj = history.length > 0 ? history[history.length - 1].effective_month : null;
  const afterAdj = lastAdj ? nextMonth(lastAdj) : null;
  return afterAdj && afterAdj > floor ? afterAdj : floor;
}

async function loadFor(employeeId: string) {
  const [adjs, paid] = await Promise.all([
    fetchSalaryAdjustments([employeeId]),
    fetchLatestPaidMonth(employeeId),
  ]);
  return { adjs, paid };
}

/**
 * 員工資料「調薪」：登記新月薪與生效月份（不可選已發放月份、須晚於最近一次調薪），
 * 可一併更新勞健保投保資料。生效月份的薪資起用新月薪，並列入該月薪資單備註、Telegram 通知員工。
 */
export function SalaryAdjustDialog({
  target,
  onClose,
  onChanged,
}: {
  /** 每位員工以 key 重新掛載，欄位自然歸零 */
  target: SalaryAdjustTarget;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [history, setHistory] = useState<SalaryAdjustment[]>([]);
  const [latestPaid, setLatestPaid] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [newWage, setNewWage] = useState<number | null>(null);
  const [month, setMonth] = useState("");
  const [reason, setReason] = useState("");
  const [bracket, setBracket] = useState<number | null>(null);
  const [labor, setLabor] = useState<number | null>(null);
  const [health, setHealth] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { adjs, paid } = await loadFor(target.id);
        if (cancelled) return;
        setHistory(adjs);
        setLatestPaid(paid);
        setMonth(earliestMonth(adjs, paid));
        setLoaded(true);
      } catch (e) {
        if (!cancelled) toast.error(`無法載入調薪資料：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target.id]);

  const minMonth = useMemo(() => earliestMonth(history, latestPaid), [history, latestPaid]);

  /** 目前（含已登記、尚未生效）的最後月薪 */
  const lastAdj = history.length > 0 ? history[history.length - 1] : null;
  const baseWage = lastAdj ? lastAdj.new_wage : target.monthlyWage;

  async function submit() {
    if (!(newWage != null && newWage > 0)) {
      toast.error("請輸入新月薪。");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      toast.error("請選擇生效月份。");
      return;
    }
    if (month < minMonth) {
      toast.error(`生效月份最早為 ${monthLabel(minMonth)}。`);
      return;
    }
    if (!reason.trim()) {
      toast.error("請填寫調薪原因。");
      return;
    }
    const lines = [
      `確定調整「${target.name}」的月薪？`,
      ``,
      `月薪：${money(baseWage)} → ${money(newWage)}`,
      `生效：${monthLabel(month)}薪資起`,
      `原因：${reason.trim()}`,
    ];
    if (bracket != null) lines.push(`勞保投保薪資：${money(target.laborInsuranceBracket)} → ${money(bracket)}`);
    if (labor != null) lines.push(`勞保自付：${money(target.laborEmployeeBurden)} → ${money(labor)}`);
    if (health != null) lines.push(`健保自付（每人）：${money(target.healthEmployeeBurden)} → ${money(health)}`);
    lines.push(``, `會列入生效月份的薪資單備註，並以 Telegram 通知員工。`);
    if (!window.confirm(lines.join("\n"))) return;

    setSaving(true);
    const res = await createSalaryAdjustmentRpc({
      employeeId: target.id,
      effectiveMonth: month,
      newWage,
      reason: reason.trim(),
      laborInsuranceBracket: bracket,
      laborEmployeeBurden: labor,
      healthEmployeeBurden: health,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message, { duration: 10000 });
      return;
    }
    toast.success(
      res.data.applied
        ? `已調薪，${monthLabel(month)}起生效（已更新目前月薪）`
        : `已登記調薪，${monthLabel(month)}起生效`,
    );
    const { adjs, paid } = await loadFor(target.id);
    setHistory(adjs);
    setLatestPaid(paid);
    setMonth(earliestMonth(adjs, paid));
    setNewWage(null);
    setReason("");
    setBracket(null);
    setLabor(null);
    setHealth(null);
    onChanged();
  }

  async function cancel(a: SalaryAdjustment) {
    if (
      !window.confirm(
        `取消「${target.name}」${monthLabel(a.effective_month)}起的調薪（${money(a.old_wage)} → ${money(a.new_wage)}）？${
          a.applied_at ? "\n已生效，取消後目前月薪會改回 " + money(a.old_wage) + "。" : ""
        }`,
      )
    ) {
      return;
    }
    setSaving(true);
    const res = await cancelSalaryAdjustmentRpc(a.id);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("已取消調薪");
    const { adjs, paid } = await loadFor(target.id);
    setHistory(adjs);
    setLatestPaid(paid);
    setMonth(earliestMonth(adjs, paid));
    onChanged();
  }

  const latestId = lastAdj?.id ?? null;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border p-5 pb-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                調薪：{target.name}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                目前月薪 {money(target.monthlyWage)}
                {lastAdj && !lastAdj.applied_at
                  ? `（已登記 ${monthLabel(lastAdj.effective_month)}起 ${money(lastAdj.new_wage)}）`
                  : ""}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4 overflow-y-auto p-5">
            {!loaded ? (
              <p className="text-sm text-muted-foreground">載入中…</p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-xs text-muted-foreground">
                    新月薪
                    <NumericInput
                      value={newWage}
                      onValueChange={setNewWage}
                      className="mt-1 w-full"
                      aria-label="新月薪"
                    />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    生效月份（該月薪資起）
                    <input
                      type="month"
                      value={month}
                      min={minMonth}
                      onChange={(e) => setMonth(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  不能選已發放的月份{latestPaid ? `（最新已發放：${monthLabel(latestPaid)}）` : ""}；以整月生效，不按日數比例。追溯補發請用薪資結算的「調整」欄。
                </p>
                <label className="block text-xs text-muted-foreground">
                  原因（必填）
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="例如：年度調薪、升任組長"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>

                <fieldset className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3">
                  <legend className="px-1 text-xs font-medium text-foreground">投保資料（選填，空白＝不變）</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label className="block text-xs text-muted-foreground">
                      勞保投保薪資
                      <NumericInput
                        keepZero
                        value={bracket}
                        onValueChange={setBracket}
                        placeholder={target.laborInsuranceBracket != null ? `目前 ${money(target.laborInsuranceBracket)}` : ""}
                        className="mt-1 w-full"
                      />
                    </label>
                    <label className="block text-xs text-muted-foreground">
                      勞保自付
                      <NumericInput
                        keepZero
                        value={labor}
                        onValueChange={setLabor}
                        placeholder={target.laborEmployeeBurden != null ? `目前 ${money(target.laborEmployeeBurden)}` : ""}
                        className="mt-1 w-full"
                      />
                    </label>
                    <label className="block text-xs text-muted-foreground">
                      健保自付（每人）
                      <NumericInput
                        keepZero
                        value={health}
                        onValueChange={setHealth}
                        placeholder={target.healthEmployeeBurden != null ? `目前 ${money(target.healthEmployeeBurden)}` : ""}
                        className="mt-1 w-full"
                      />
                    </label>
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    系統沒有投保級距表，請依新月薪自行查級距填寫，並記得向勞保局、健保署申報投保薪資調整。雇主負擔請到「編輯員工」更新。
                  </p>
                </fieldset>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
                    關閉
                  </Button>
                  <Button type="button" disabled={saving} onClick={() => void submit()}>
                    {saving ? "處理中…" : "確定調薪"}
                  </Button>
                </div>

                <section className="space-y-2 border-t border-border pt-3">
                  <h3 className="text-xs font-semibold text-foreground">調薪紀錄</h3>
                  {history.length === 0 ? (
                    <p className="text-xs text-muted-foreground">尚無調薪紀錄。</p>
                  ) : (
                    <ul className="space-y-2">
                      {[...history].reverse().map((a) => (
                        <li
                          key={a.id}
                          className="flex flex-col gap-1 rounded-lg border border-border/80 p-2.5 text-xs sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-x-2 text-foreground">
                              <span className="font-medium">{monthLabel(a.effective_month)}起</span>
                              <span className="tabular-nums">
                                {money(a.old_wage)} → {money(a.new_wage)}
                              </span>
                              <span
                                className={
                                  a.applied_at
                                    ? "text-emerald-700 dark:text-emerald-400"
                                    : "text-amber-700 dark:text-amber-400"
                                }
                              >
                                {a.applied_at ? "已生效" : "尚未生效"}
                              </span>
                            </p>
                            <p className="text-muted-foreground">{a.reason}</p>
                          </div>
                          {a.id === latestId && !(latestPaid && a.effective_month <= latestPaid) ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-7 shrink-0 self-start px-2 text-[11px] sm:self-center"
                              disabled={saving}
                              onClick={() => void cancel(a)}
                            >
                              取消
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
