"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, ChevronDown, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured, supabase, SUPABASE_CONFIG_HELP } from "@/lib/supabase";

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 本月 1 號～max(本月最後一天, 今天+30 天) */
function listRangeIso(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const firstOfMonth = new Date(y, mo, 1);
  const lastOfMonth = new Date(y, mo + 1, 0);
  const plus30 = new Date(y, mo, now.getDate() + 30);
  const end = lastOfMonth.getTime() > plus30.getTime() ? lastOfMonth : plus30;
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(firstOfMonth), end: fmt(end) };
}

type HolidayRow = {
  id: string;
  holiday_date: string;
  name: string;
  is_workday: boolean;
  is_paid: boolean;
};

function statusBadge(row: HolidayRow) {
  if (row.is_workday) {
    return (
      <Badge variant="secondary" className="border-slate-400/40 bg-slate-200/80 text-slate-900 dark:bg-slate-800 dark:text-slate-100">
        補班日
      </Badge>
    );
  }
  if (!row.is_paid) {
    return (
      <Badge
        variant="outline"
        className="border-fuchsia-600/50 bg-fuchsia-100 text-fuchsia-950 dark:border-fuchsia-500/40 dark:bg-fuchsia-950/50 dark:text-fuchsia-100"
      >
        不支薪放假
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-emerald-600/40 bg-emerald-100 text-emerald-950 dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-50"
    >
      支薪放假
    </Badge>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-7 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}

export function PublicHolidaysAdminCard({ onMutate }: { onMutate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [rows, setRows] = useState<HolidayRow[]>([]);
  const [dateStr, setDateStr] = useState(todayIsoDate);
  const [name, setName] = useState("");
  const [isWorkday, setIsWorkday] = useState(false);
  const [isPaid, setIsPaid] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HolidayRow | null>(null);
  /** 新增時與既有 holiday_date 衝突，供使用者選擇覆寫 */
  const [overwriteTarget, setOverwriteTarget] = useState<HolidayRow | null>(null);

  const loadList = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setRows([]);
      return;
    }
    setListLoading(true);
    try {
      const { start, end } = listRangeIso();
      const { data, error } = await supabase
        .from("public_holidays")
        .select("id, holiday_date, name, is_workday, is_paid")
        .gte("holiday_date", start)
        .lte("holiday_date", end)
        .order("holiday_date", { ascending: true });
      if (error) throw error;
      const next: HolidayRow[] = (data ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        return {
          id: String(rec.id),
          holiday_date: String(rec.holiday_date ?? "").slice(0, 10),
          name: String(rec.name ?? ""),
          is_workday: rec.is_workday === true,
          is_paid: rec.is_paid !== false,
        };
      });
      setRows(next);
    } catch (e) {
      console.error("[public_holidays] list:", e);
      toast.error(e instanceof Error ? e.message : "無法載入假日列表");
      setRows([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  function rowFromSupabaseRecord(rec: Record<string, unknown>): HolidayRow {
    return {
      id: String(rec.id),
      holiday_date: String(rec.holiday_date ?? "").slice(0, 10),
      name: String(rec.name ?? ""),
      is_workday: rec.is_workday === true,
      is_paid: rec.is_paid !== false,
    };
  }

  useEffect(() => {
    if (!open) return;
    void loadList();
  }, [open, loadList]);

  async function fetchHolidayByDate(isoDate: string): Promise<HolidayRow | null> {
    const { data, error } = await supabase
      .from("public_holidays")
      .select("id, holiday_date, name, is_workday, is_paid")
      .eq("holiday_date", isoDate)
      .maybeSingle();
    if (error || !data) return null;
    return rowFromSupabaseRecord(data as Record<string, unknown>);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      toast.error(SUPABASE_CONFIG_HELP);
      return;
    }
    const n = name.trim();
    if (!n) {
      toast.error("請填寫事由名稱。");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      toast.error("請選擇有效日期。");
      return;
    }
    setSubmitting(true);
    try {
      const existing = await fetchHolidayByDate(dateStr);
      if (existing) {
        setOverwriteTarget(existing);
        return;
      }

      const { error } = await supabase.from("public_holidays").insert({
        holiday_date: dateStr,
        name: n,
        is_workday: isWorkday,
        is_paid: isPaid,
      });
      if (error) {
        if (error.code === "23505" || error.message.includes("unique")) {
          const ex = await fetchHolidayByDate(dateStr);
          if (ex) {
            setOverwriteTarget(ex);
            return;
          }
          toast.error("該日期已存在設定，但無法讀取現有資料，請重新整理後再試。");
        } else {
          throw error;
        }
        return;
      }
      toast.success("已新增特殊假日。");
      setName("");
      setIsWorkday(false);
      setIsPaid(true);
      onMutate?.();
      await loadList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "新增失敗");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmOverwrite() {
    if (!overwriteTarget || !isSupabaseConfigured) return;
    const n = name.trim();
    if (!n) {
      toast.error("請填寫事由名稱。");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("public_holidays")
        .update({
          name: n,
          is_workday: isWorkday,
          is_paid: isPaid,
        })
        .eq("id", overwriteTarget.id);
      if (error) throw error;
      toast.success("已覆寫該日特殊假日設定。");
      setOverwriteTarget(null);
      setName("");
      setIsWorkday(false);
      setIsPaid(true);
      onMutate?.();
      await loadList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "覆寫失敗");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || !isSupabaseConfigured) return;
    const { error } = await supabase.from("public_holidays").delete().eq("id", deleteTarget.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("已刪除。");
    onMutate?.();
    await loadList();
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        {SUPABASE_CONFIG_HELP} 未連線時無法維護 public_holidays。
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-serif text-base font-semibold text-foreground">
          <CalendarDays className="h-5 w-5 text-primary" aria-hidden />
          📅 手動設定特殊假日
        </span>
        <ChevronDown
          className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-5 border-t border-border px-4 py-4">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              新增颱風假、公司特休等寫入 <code className="rounded bg-muted px-1">public_holidays</code>
              ，戰情室會依 is_workday／is_paid 自動判定標籤。
            </p>
            <div>
              <label htmlFor="ph-date" className="text-sm font-medium text-foreground">
                日期 <span className="text-destructive">*</span>
              </label>
              <input
                id="ph-date"
                type="date"
                required
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="mt-1.5 h-10 w-full max-w-xs rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label htmlFor="ph-name" className="text-sm font-medium text-foreground">
                事由名稱 <span className="text-destructive">*</span>
              </label>
              <input
                id="ph-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：凱米颱風假、員工旅遊"
                className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="rounded-lg border border-border/80 bg-muted/20 px-3">
              <ToggleRow
                label="放假／補班"
                hint="關閉＝放假；開啟＝此日為補班（視同平日出勤規則）。預設放假。"
                checked={isWorkday}
                onCheckedChange={setIsWorkday}
              />
              <ToggleRow
                label="是否支薪"
                hint="放假日是否支薪。颱風假若不支薪請關閉；預設支薪。"
                checked={isPaid}
                onCheckedChange={setIsPaid}
              />
            </div>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              確認新增
            </Button>
          </form>

          <div>
            <p className="text-sm font-semibold text-foreground">已設定列表</p>
            <p className="mt-1 text-xs text-muted-foreground">
              顯示範圍：本月 1 日起至「本月最末日」與「今天起 30 天內」兩者中較晚者。
            </p>
            {listLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                載入中…
              </div>
            ) : rows.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">此範圍內尚無資料。</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
                        {r.holiday_date.replace(/-/g, "/")}
                      </p>
                      <p className="text-sm text-foreground">{r.name}</p>
                      <div>{statusBadge(r)}</div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 shrink-0 gap-1 px-3 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(r)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      刪除
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="刪除此筆特殊假日？"
        description={
          deleteTarget ? (
            <>
              {deleteTarget.holiday_date.replace(/-/g, "/")} · {deleteTarget.name}
            </>
          ) : null
        }
        confirmLabel="刪除"
        destructive
        onConfirm={() => void confirmDelete()}
      />

      <ConfirmDialog
        open={overwriteTarget != null}
        onOpenChange={(o) => {
          if (!o) setOverwriteTarget(null);
        }}
        title="此日期已有設定"
        description={
          overwriteTarget ? (
            <div className="space-y-2">
              <p>
                <span className="font-medium text-foreground">
                  {overwriteTarget.holiday_date.replace(/-/g, "/")}
                </span>{" "}
                目前為「{overwriteTarget.name}」
                {overwriteTarget.is_workday ? "（補班日）" : "（放假日）"}
                {overwriteTarget.is_paid ? "、支薪" : "、不支薪"}。
              </p>
              <p>
                表單目前輸入將<strong className="text-foreground">覆寫</strong>該筆（日期不變）：「
                {name.trim() || "（未填名稱）"}」
                {isWorkday ? "、補班" : "、放假"}
                {isPaid ? "、支薪" : "、不支薪"}。
              </p>
            </div>
          ) : null
        }
        confirmLabel="覆寫"
        cancelLabel="取消"
        destructive
        onConfirm={() => void confirmOverwrite()}
      />
    </div>
  );
}
