"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  activeAnnouncements,
  fetchEmployeePortalData,
  workProgressStatusLabels,
  type EmployeePortalPayload,
  type LeaveRequestRow,
  type TaskStatus,
  type WorkProgressSeedRow,
  type WorkProgressUiStatus,
} from "@/lib/employee-portal-mock";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CalendarPlus, ClipboardList, Factory, Leaf, Megaphone, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

function leaveStatusBadge(row: LeaveRequestRow) {
  if (row.status === "pending") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/50 bg-amber-100 text-amber-900 dark:border-amber-600/50 dark:bg-amber-950/60 dark:text-amber-100"
      >
        待審核
      </Badge>
    );
  }
  if (row.status === "approved") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-600/40 bg-emerald-100 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-100"
      >
        已核准
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-red-500/45 bg-red-100 text-red-900 dark:border-red-500/40 dark:bg-red-950/50 dark:text-red-100"
    >
      退回
    </Badge>
  );
}

function taskStatusLabel(s: TaskStatus) {
  if (s === "todo") return "待辦";
  if (s === "in_progress") return "進行中";
  return "已完成";
}

function taskStatusStyle(s: TaskStatus) {
  if (s === "todo") return "bg-[var(--kanban-todo)] text-secondary-foreground";
  if (s === "in_progress") return "bg-[var(--kanban-progress)] text-foreground";
  return "bg-[var(--kanban-done)] text-[var(--badge-done-fg)]";
}

function StatMini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[5.5rem] min-w-[7.25rem] flex-1 flex-col justify-center rounded-xl border border-border/80 bg-background/85 px-4 py-3.5 shadow-sm backdrop-blur-sm">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="mt-1.5 text-lg font-semibold tabular-nums tracking-tight text-primary sm:text-xl">
        {children}
      </span>
    </div>
  );
}

function workProgressRowTone(status: WorkProgressUiStatus) {
  switch (status) {
    case "done":
      return "bg-muted/50 opacity-[0.88]";
    case "in_progress":
      return "bg-secondary/35";
    default:
      return "bg-card hover:bg-muted/25";
  }
}

const PROGRESS_DEFAULTS: WorkProgressUiStatus[] = [
  "pending",
  "in_progress",
  "in_progress",
  "done",
];

function seedProgressState(rows: WorkProgressSeedRow[]): Record<string, WorkProgressUiStatus> {
  const next: Record<string, WorkProgressUiStatus> = {};
  rows.forEach((r, i) => {
    next[r.id] = PROGRESS_DEFAULTS[i % PROGRESS_DEFAULTS.length];
  });
  return next;
}

export default function EmployeePortalPage() {
  const [data, setData] = useState<EmployeePortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set());
  const [progressById, setProgressById] = useState<Record<string, WorkProgressUiStatus>>({});
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    type: "特休",
    start: "",
    end: "",
    reason: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // TODO: 改為 supabase — const payload = await fetchFromSupabase(employeeId);
      const payload = await fetchEmployeePortalData();
      setData(payload);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!data?.work_progress_seed?.length) return;
    setProgressById(seedProgressState(data.work_progress_seed));
  }, [data]);

  const announcements = useMemo(
    () => (data ? activeAnnouncements(data.announcements) : []),
    [data]
  );

  const visibleTasks = useMemo(() => {
    if (!data) return [];
    return data.tasks.filter((t) => t.status === "todo" || t.status === "in_progress");
  }, [data]);

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("zh-TW", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      }),
    []
  );

  function toggleTaskComplete(id: string, checked: boolean) {
    setCompletedTaskIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function submitLeaveRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!leaveForm.start || !leaveForm.end) {
      toast.error("請填寫起迄日期");
      return;
    }
    toast.success("假單已送出（Mock：實際將寫入 leave_requests）");
    setLeaveOpen(false);
    setLeaveForm({ type: "特休", start: "", end: "", reason: "" });
  }

  if (loading || !data) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground tracking-wide">載入個人儀表板…</p>
      </div>
    );
  }

  const { employee, stats, leave_requests, work_progress_seed } = data;

  return (
    <div
      className={cn(
        "min-h-dvh text-foreground",
        "bg-background",
        "bg-[radial-gradient(ellipse_120%_80%_at_100%_-20%,rgba(196,168,130,0.14),transparent_50%)]",
        "dark:bg-[radial-gradient(ellipse_120%_80%_at_100%_-20%,rgba(196,168,130,0.1),transparent_50%)]"
      )}
    >
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <header className="mb-10 lg:mb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Føre Furniture · 實木工坊
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            員工個人儀表板
          </h1>
        </header>

        <div className="flex flex-col gap-8 lg:gap-10">
          {/* 今日工作台 */}
          <section
            className={cn(
              "relative overflow-hidden rounded-2xl border border-border/90",
              "bg-gradient-to-br from-card via-card to-secondary/35",
              "shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_12px_40px_-12px_rgba(44,36,24,0.1)]",
              "dark:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_12px_40px_-12px_rgba(0,0,0,0.4)]",
              "p-6 sm:p-8 lg:p-10"
            )}
          >
            <div
              className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-accent/15 blur-3xl"
              aria-hidden
            />
            <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-4">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/80 bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  今日工作台
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  歡迎回來，{employee.full_name}
                </h2>
                <p className="text-sm tabular-nums text-muted-foreground">{todayLabel}</p>
              </div>
              <div className="flex w-full shrink-0 flex-col gap-3 sm:flex-row lg:max-w-xl lg:flex-1">
                <StatMini label="本月薪資">
                  NT${" "}
                  {stats.monthly_salary_ntd.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
                </StatMini>
                <StatMini label="本月加班天數">{stats.monthly_overtime_days} 天</StatMini>
                <StatMini label="本月請假天數">{stats.monthly_leave_days} 天</StatMini>
              </div>
            </div>
          </section>

          {/* 公司公告 */}
          <section className="rounded-2xl border border-border/90 bg-card p-6 shadow-sm sm:p-8">
            <div className="mb-5 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary">
                <Megaphone className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-base font-semibold">公司公告</h3>
                <p className="text-xs text-muted-foreground">announcements · is_active = true</p>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">
              <ul className="space-y-4 pr-2">
                {announcements.length === 0 ? (
                  <li className="text-sm text-muted-foreground">目前沒有有效公告。</li>
                ) : (
                  announcements.map((a) => (
                    <li
                      key={a.id}
                      className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3.5 transition-colors hover:bg-muted/35"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-foreground">{a.title}</span>
                        <time className="text-xs tabular-nums text-muted-foreground">
                          {a.published_at}
                        </time>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{a.body}</p>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </section>

          {/* 我的交辦 */}
          <section className="rounded-2xl border border-border/90 bg-card p-6 shadow-sm sm:p-8">
            <div className="mb-5 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary">
                <ClipboardList className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-base font-semibold">我的交辦事項</h3>
                <p className="text-xs text-muted-foreground">employee_tasks · 待辦與進行中</p>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">
              <ul className="space-y-2 pr-2">
                {visibleTasks.length === 0 ? (
                  <li className="text-sm text-muted-foreground">沒有待辦或進行中的任務。</li>
                ) : (
                  visibleTasks.map((t) => {
                    const done = completedTaskIds.has(t.id);
                    return (
                      <li
                        key={t.id}
                        className={cn(
                          "flex gap-3 rounded-xl border border-border/60 px-3 py-3 sm:px-4",
                          "bg-muted/15 transition-colors hover:bg-muted/25"
                        )}
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={done}
                            onChange={(e) => toggleTaskComplete(t.id, e.target.checked)}
                            className="mt-1 size-4 shrink-0 rounded border-input text-primary focus:ring-ring"
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block font-medium",
                                done && "text-muted-foreground line-through decoration-border"
                              )}
                            >
                              {t.title}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium",
                                  taskStatusStyle(t.status)
                                )}
                              >
                                {taskStatusLabel(t.status)}
                              </span>
                              {t.due_date && (
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  截止 {t.due_date}
                                </span>
                              )}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </section>

          {/* 我的進度追蹤 */}
          <section
            className={cn(
              "rounded-2xl border-2 border-primary/15 bg-card p-6 shadow-md sm:p-8 lg:p-10",
              "ring-1 ring-border/40"
            )}
          >
            <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Factory className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold tracking-tight sm:text-xl">我的進度追蹤</h3>
                  <p className="text-xs text-muted-foreground">生產工單 · 現場狀態（Mock，下拉為本地 State）</p>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border/70">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3.5 font-medium">訂單／生產單號</th>
                    <th className="px-4 py-3.5 font-medium">負責工序</th>
                    <th className="px-4 py-3.5 font-medium">預計完成日</th>
                    <th className="px-4 py-3.5 font-medium min-w-[9rem]">目前狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {work_progress_seed.map((row) => {
                    const status = progressById[row.id] ?? "pending";
                    const isDone = status === "done";
                    return (
                      <tr
                        key={row.id}
                        className={cn(
                          "border-b border-border/60 transition-colors last:border-0",
                          workProgressRowTone(status)
                        )}
                      >
                        <td
                          className={cn(
                            "px-4 py-3.5 font-medium text-foreground",
                            isDone && "text-muted-foreground line-through decoration-border/80"
                          )}
                        >
                          {row.order_ref}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3.5 text-muted-foreground",
                            isDone && "line-through opacity-90"
                          )}
                        >
                          {row.stage_label}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3.5 tabular-nums text-muted-foreground",
                            isDone && "line-through opacity-90"
                          )}
                        >
                          {row.expected_complete_date}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={status}
                            onChange={(e) => {
                              const v = e.target.value as WorkProgressUiStatus;
                              setProgressById((prev) => ({ ...prev, [row.id]: v }));
                            }}
                            className={cn(
                              "h-9 w-full max-w-[11rem] rounded-lg border border-input bg-background px-2.5 text-sm text-foreground",
                              "focus:outline-none focus:ring-2 focus:ring-ring"
                            )}
                            aria-label={`${row.order_ref} 狀態`}
                          >
                            {(Object.keys(workProgressStatusLabels) as WorkProgressUiStatus[]).map((k) => (
                              <option key={k} value={k}>
                                {workProgressStatusLabels[k]}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* 我的請假狀態 */}
          <section className="rounded-2xl border border-border/90 bg-card p-6 shadow-sm sm:p-8">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary">
                  <Leaf className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold">我的請假狀態</h3>
                  <p className="text-xs text-muted-foreground">leave_requests · 近期紀錄</p>
                </div>
              </div>
              <Button
                type="button"
                size="default"
                className="shrink-0 gap-1.5 self-start sm:self-auto"
                onClick={() => setLeaveOpen(true)}
              >
                <CalendarPlus className="h-4 w-4" />
                申請休假
              </Button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">假別</th>
                    <th className="px-4 py-3 font-medium">區間</th>
                    <th className="px-4 py-3 font-medium">天數</th>
                    <th className="px-4 py-3 font-medium">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {leave_requests.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/15"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{row.type_label}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {row.start_date} — {row.end_date}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {row.days_count}
                      </td>
                      <td className="px-4 py-3">{leaveStatusBadge(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <Dialog.Root open={leaveOpen} onOpenChange={setLeaveOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-xl focus:outline-none">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-lg font-semibold text-foreground">申請休假</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  填寫後送出（Mock）。實際將寫入 leave_requests 並進入審核流程。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="關閉"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <form onSubmit={submitLeaveRequest} className="space-y-4">
              <div>
                <label htmlFor="leave-type" className="mb-1.5 block text-sm font-medium text-foreground">
                  假別
                </label>
                <select
                  id="leave-type"
                  value={leaveForm.type}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, type: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="特休">特休</option>
                  <option value="事假">事假</option>
                  <option value="病假">病假</option>
                  <option value="補休">補休</option>
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="leave-start" className="mb-1.5 block text-sm font-medium text-foreground">
                    開始日
                  </label>
                  <input
                    id="leave-start"
                    type="date"
                    value={leaveForm.start}
                    onChange={(e) => setLeaveForm((f) => ({ ...f, start: e.target.value }))}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label htmlFor="leave-end" className="mb-1.5 block text-sm font-medium text-foreground">
                    結束日
                  </label>
                  <input
                    id="leave-end"
                    type="date"
                    value={leaveForm.end}
                    onChange={(e) => setLeaveForm((f) => ({ ...f, end: e.target.value }))}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="leave-reason" className="mb-1.5 block text-sm font-medium text-foreground">
                  事由
                </label>
                <textarea
                  id="leave-reason"
                  rows={3}
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="簡述申請原因…"
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    取消
                  </Button>
                </Dialog.Close>
                <Button type="submit">送出申請</Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
