"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import imageCompression from "browser-image-compression";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  deleteMeetingMinute,
  fetchActiveEmployeesForMeeting,
  fetchMeetingMinutesListSafe,
  insertMeetingMinute,
  updateMeetingMinute,
  type ActiveEmployeeOption,
  type MeetingMinuteListRow,
} from "@/lib/meeting-minutes";
import { getSupabaseSession, isSupabaseConfigured } from "@/lib/supabase";
import {
  CalendarDays,
  ChevronDown,
  ClipboardList,
  ImagePlus,
  Loader2,
  Pencil,
  Trash2,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

/** 歷史列表預設顯示筆數，其餘以「展開」區塊呈現 */
const MEETING_HISTORY_VISIBLE_FIRST = 4;

const PREVIEW_COMPRESSION = {
  maxSizeMB: 0.35,
  /** 約比 400px 大 30%，預覽較清楚 */
  maxWidthOrHeight: Math.round(400 * 1.3),
  useWebWorker: true,
} as const;

type AssignmentRow = { localId: string; text: string; assigneeIds: string[] };

function newAssignmentRow(): AssignmentRow {
  return { localId: crypto.randomUUID(), text: "", assigneeIds: [] };
}

function formatMeetingDate(iso: string): string {
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return iso;
  const [y, m, dayNum] = d.split("-").map(Number);
  return `${y} 年 ${m} 月 ${dayNum} 日`;
}

/** 列表列標題用 yy/mm/dd，省寬度以便顯示紀錄者 */
function formatMeetingDateShort(iso: string): string {
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return iso;
  const [y, m, dayNum] = d.split("-").map(Number);
  const yy = String(y).slice(-2);
  return `${yy}/${String(m).padStart(2, "0")}/${String(dayNum).padStart(2, "0")}`;
}

type KeptExistingPhoto = { id: string; storage_path: string; public_url: string | null };

interface MeetingMinutesSectionProps {
  currentEmployeeId: string;
  currentEmployeeName: string;
  onRefreshParent?: () => void | Promise<void>;
  /** 父層遞增時重新載入列表（例如交辦狀態變更） */
  refreshTick?: number;
  /** 成功儲存一筆開會紀錄後呼叫（父層可同步「我的交辦」等） */
  onMeetingSaved?: () => void;
  /** admin／manager：可編輯任意一筆歷史紀錄 */
  canManageMeetingMinutes?: boolean;
  /** 僅 admin：可刪除歷史紀錄（紀錄人員可編輯但不可刪） */
  canDeleteMeetingMinutes?: boolean;
  /** admin：顯示資料表／儲存位置等技術說明 */
  showAdminHints?: boolean;
}

export function MeetingMinutesSection({
  currentEmployeeId,
  currentEmployeeName,
  onRefreshParent,
  refreshTick = 0,
  onMeetingSaved,
  canManageMeetingMinutes = false,
  canDeleteMeetingMinutes = false,
  showAdminHints = false,
}: MeetingMinutesSectionProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editMinuteId, setEditMinuteId] = useState<string | null>(null);
  const [keptExistingAttachments, setKeptExistingAttachments] = useState<KeptExistingPhoto[]>([]);
  const [staff, setStaff] = useState<ActiveEmployeeOption[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [list, setList] = useState<MeetingMinuteListRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listHint, setListHint] = useState<string | null>(null);

  const [recorderId, setRecorderId] = useState(currentEmployeeId);
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [attendeeIds, setAttendeeIds] = useState<Set<string>>(() => new Set());
  const [announcements, setAnnouncements] = useState("");
  const [weeklyWorkNotes, setWeeklyWorkNotes] = useState("");
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [discussionNotes, setDiscussionNotes] = useState("");
  /** 週五工坊維護輪替（立式 2、其餘各 1） */
  const [rotationVertical, setRotationVertical] = useState<string[]>([]);
  const [rotationHand, setRotationHand] = useState<string[]>([]);
  const [rotationSupervisor, setRotationSupervisor] = useState<string[]>([]);
  const [rotationDuty, setRotationDuty] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>(() => [newAssignmentRow()]);
  const [pendingImages, setPendingImages] = useState<{ file: File; previewUrl: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const recorderOptions = useMemo(() => {
    const ids = new Set(staff.map((s) => s.id));
    if (!ids.has(currentEmployeeId)) {
      return [{ id: currentEmployeeId, name: currentEmployeeName }, ...staff];
    }
    return staff;
  }, [staff, currentEmployeeId, currentEmployeeName]);

  const staffNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of staff) m.set(e.id, e.name);
    m.set(currentEmployeeId, currentEmployeeName);
    return m;
  }, [staff, currentEmployeeId, currentEmployeeName]);

  const loadStaff = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setStaffLoading(true);
    try {
      const r = await fetchActiveEmployeesForMeeting();
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setStaff(r.rows);
    } finally {
      setStaffLoading(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setListLoading(true);
    setListError(null);
    setListHint(null);
    try {
      const r = await fetchMeetingMinutesListSafe(40);
      if (!r.ok) {
        setListError(r.message);
        setListHint("hint" in r ? r.hint ?? null : null);
        setList([]);
        return;
      }
      setList(r.rows);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    void loadList();
  }, [loadList, refreshTick]);

  function resetFormForNewEntry() {
    setEditMinuteId(null);
    setKeptExistingAttachments([]);
    setRecorderId(currentEmployeeId);
    setMeetingDate(new Date().toISOString().slice(0, 10));
    setAttendeeIds(new Set());
    setAnnouncements("");
    setWeeklyWorkNotes("");
    setFeedbackNotes("");
    setDiscussionNotes("");
    setRotationVertical([]);
    setRotationHand([]);
    setRotationSupervisor([]);
    setRotationDuty([]);
    setAssignments([newAssignmentRow()]);
    setPendingImages((prev) => {
      prev.forEach((p) => {
        if (p.previewUrl.startsWith("blob:")) URL.revokeObjectURL(p.previewUrl);
      });
      return [];
    });
  }

  function openEdit(row: MeetingMinuteListRow) {
    setEditMinuteId(row.id);
    setRecorderId(row.recorder_id);
    setMeetingDate(row.meeting_date.slice(0, 10));
    setAttendeeIds(new Set((row.meeting_minute_attendees ?? []).map((x) => x.employee_id)));
    setAnnouncements(row.announcements ?? "");
    setWeeklyWorkNotes(row.weekly_work_notes ?? "");
    setFeedbackNotes(row.feedback_notes ?? "");
    setDiscussionNotes(row.discussion_notes ?? "");
    setRotationVertical([...(row.workshop_rotation_vertical ?? [])]);
    setRotationHand([...(row.workshop_rotation_hand ?? [])]);
    setRotationSupervisor([...(row.workshop_rotation_supervisor ?? [])]);
    setRotationDuty([...(row.workshop_rotation_duty ?? [])]);
    const sortedAsg = [...(row.meeting_minute_assignments ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    setAssignments(
      sortedAsg.length > 0
        ? sortedAsg.map((a) => ({
            localId: crypto.randomUUID(),
            text: a.content,
            assigneeIds: [...(a.assignee_ids ?? [])],
          }))
        : [newAssignmentRow()],
    );
    setKeptExistingAttachments(
      (row.meeting_minute_attachments ?? []).map((a) => ({
        id: a.id,
        storage_path: a.storage_path,
        public_url: a.public_url,
      })),
    );
    setPendingImages((prev) => {
      prev.forEach((p) => {
        if (p.previewUrl.startsWith("blob:")) URL.revokeObjectURL(p.previewUrl);
      });
      return [];
    });
    setFormOpen(true);
  }

  function removeExistingAttachment(id: string) {
    setKeptExistingAttachments((prev) => prev.filter((k) => k.id !== id));
  }

  async function handleDeleteMinute(row: MeetingMinuteListRow) {
    if (!isSupabaseConfigured) return;
    if (
      !window.confirm(
        `確定刪除 ${formatMeetingDate(row.meeting_date)} 的開會紀錄？此動作無法復原。`,
      )
    ) {
      return;
    }
    const r = await deleteMeetingMinute(row.id);
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    toast.success("已刪除");
    await loadList();
    onMeetingSaved?.();
    await onRefreshParent?.();
  }

  useEffect(() => {
    if (!formOpen) return;
    if (editMinuteId) return;
    resetFormForNewEntry();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在「新增」開啟對話框時重設
  }, [formOpen, editMinuteId]);

  function toggleAttendee(id: string) {
    setAttendeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAssignmentAssignee(row: AssignmentRow, empId: string) {
    setAssignments((rows) =>
      rows.map((r) => {
        if (r.localId !== row.localId) return r;
        const has = r.assigneeIds.includes(empId);
        const assigneeIds = has
          ? r.assigneeIds.filter((x) => x !== empId)
          : [...r.assigneeIds, empId];
        return { ...r, assigneeIds };
      }),
    );
  }

  function addAssignmentRow() {
    setAssignments((rows) => [...rows, newAssignmentRow()]);
  }

  function removeAssignmentRow(localId: string) {
    setAssignments((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.localId !== localId)));
  }

  function toggleRotationVertical(empId: string) {
    setRotationVertical((prev) => {
      if (prev.includes(empId)) return prev.filter((x) => x !== empId);
      if (prev.length >= 2) {
        toast.error("立式機具保養最多 2 人");
        return prev;
      }
      return [...prev, empId];
    });
  }

  function toggleRotationHand(empId: string) {
    setRotationHand((prev) => {
      if (prev.includes(empId)) return prev.filter((x) => x !== empId);
      if (prev.length >= 1) {
        toast.error("手工機具保養為 1 人，請先取消已選人員");
        return prev;
      }
      return [empId];
    });
  }

  function toggleRotationSupervisor(empId: string) {
    setRotationSupervisor((prev) => {
      if (prev.includes(empId)) return prev.filter((x) => x !== empId);
      if (prev.length >= 1) {
        toast.error("機動監督為 1 人，請先取消已選人員");
        return prev;
      }
      return [empId];
    });
  }

  function toggleRotationDuty(empId: string) {
    setRotationDuty((prev) => {
      if (prev.includes(empId)) return prev.filter((x) => x !== empId);
      if (prev.length >= 1) {
        toast.error("值日生為 1 人，請先取消已選人員");
        return prev;
      }
      return [empId];
    });
  }

  async function onPickImages(files: FileList | null) {
    if (!files?.length) return;
    const next: { file: File; previewUrl: string }[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        toast.error("請選擇圖片檔案");
        continue;
      }
      try {
        const compressed = await imageCompression(file, PREVIEW_COMPRESSION);
        const url = URL.createObjectURL(compressed);
        next.push({ file: compressed, previewUrl: url });
      } catch {
        const url = URL.createObjectURL(file);
        next.push({ file, previewUrl: url });
      }
    }
    setPendingImages((prev) => [...prev, ...next]);
  }

  function removePendingImage(index: number) {
    setPendingImages((prev) => {
      const t = prev[index];
      if (t?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(t.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!meetingDate.trim()) {
      toast.error("請選擇開會日期");
      return;
    }
    if (!recorderId) {
      toast.error("請選擇紀錄人員");
      return;
    }

    const assignmentPayload = assignments.map((a) => ({
      content: a.text,
      assigneeIds: a.assigneeIds,
    }));

    if (!isSupabaseConfigured) {
      toast.success("（Mock）開會紀錄已預覽送出；設定 Supabase 後會寫入 employees schema。");
      setFormOpen(false);
      onMeetingSaved?.();
      await onRefreshParent?.();
      return;
    }

    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await getSupabaseSession();
      const uid = session?.user?.id ?? null;

      if (editMinuteId) {
        const r = await updateMeetingMinute({
          meetingMinuteId: editMinuteId,
          recorderId,
          meetingDate: meetingDate.trim(),
          attendeeIds: [...attendeeIds],
          announcements,
          weeklyWorkNotes,
          feedbackNotes,
          discussionNotes,
          workshopRotation: {
            vertical: rotationVertical,
            hand: rotationHand,
            supervisor: rotationSupervisor,
            duty: rotationDuty,
          },
          assignments: assignmentPayload,
          createdByUserId: uid,
          imageFiles: pendingImages.map((p) => p.file),
          keptAttachments: keptExistingAttachments
            .filter((k) => k.public_url)
            .map((k) => ({
              storage_path: k.storage_path,
              public_url: k.public_url!,
            })),
        });
        if (!r.ok) {
          toast.error(r.message);
          return;
        }
        toast.success("開會紀錄已更新");
      } else {
        const r = await insertMeetingMinute({
          recorderId,
          meetingDate: meetingDate.trim(),
          attendeeIds: [...attendeeIds],
          announcements,
          weeklyWorkNotes,
          feedbackNotes,
          discussionNotes,
          workshopRotation: {
            vertical: rotationVertical,
            hand: rotationHand,
            supervisor: rotationSupervisor,
            duty: rotationDuty,
          },
          assignments: assignmentPayload,
          createdByUserId: uid,
          imageFiles: pendingImages.map((p) => p.file),
        });

        if (!r.ok) {
          toast.error(r.message);
          return;
        }
        toast.success("開會紀錄已儲存");
      }

      setFormOpen(false);
      setEditMinuteId(null);
      onMeetingSaved?.();
      await loadList();
      await onRefreshParent?.();
    } finally {
      setSubmitting(false);
    }
  }

  const renderOneHistoryRow = (row: MeetingMinuteListRow) => {
    const recorderName = staffNameById.get(row.recorder_id) ?? "（未知）";
    const atts = [...(row.meeting_minute_attachments ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    return (
      <li key={row.id}>
        <details className="group rounded-xl border border-border/70 bg-muted/10 open:bg-muted/15">
          <summary className="cursor-pointer list-none px-4 py-2.5 sm:px-5 sm:py-3 [&::-webkit-details-marker]:hidden">
            <div className="flex flex-row items-center justify-between gap-2">
              <span className="min-w-0 flex-1 text-sm font-medium leading-tight text-foreground sm:text-base">
                <span className="tabular-nums">{formatMeetingDateShort(row.meeting_date)}</span>
                <span className="ml-1.5 text-xs font-normal text-muted-foreground sm:ml-2 sm:text-sm">
                  紀錄：{recorderName}
                </span>
              </span>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                {isSupabaseConfigured &&
                (canManageMeetingMinutes || row.recorder_id === currentEmployeeId) ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/80 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                    onClick={(e) => {
                      e.preventDefault();
                      openEdit(row);
                    }}
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                    編輯
                  </button>
                ) : null}
                {isSupabaseConfigured && canDeleteMeetingMinutes ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-destructive/35 bg-background/80 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.preventDefault();
                      void handleDeleteMinute(row);
                    }}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    刪除
                  </button>
                ) : null}
              </div>
            </div>
          </summary>
          <div className="space-y-3 border-t border-border/50 px-4 py-3 text-sm sm:px-5 sm:py-4">
            <DetailBlock label="公告事項" text={row.announcements} />
            <DetailBlock label="本週工作事項" text={row.weekly_work_notes} />
            {(() => {
              const v = row.workshop_rotation_vertical ?? [];
              const h = row.workshop_rotation_hand ?? [];
              const sup = row.workshop_rotation_supervisor ?? [];
              const d = row.workshop_rotation_duty ?? [];
              if (!v.length && !h.length && !sup.length && !d.length) return null;
              const line = (ids: string[]) =>
                ids.length > 0 ? ids.map((id) => staffNameById.get(id) ?? "…").join("、") : "—";
              const cells = [
                { label: "立式機具（2）", text: line(v) },
                { label: "手工機具", text: line(h) },
                { label: "機動監督", text: line(sup) },
                { label: "值日生", text: line(d) },
              ];
              return (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-2.5 py-2 dark:bg-amber-500/10 sm:px-3">
                  <p className="mb-2 text-[10px] font-medium text-muted-foreground">週五工坊維護輪替</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {cells.map((c) => (
                      <div
                        key={c.label}
                        className="min-w-0 rounded-lg border border-border/50 bg-background/40 px-2 py-1.5 sm:px-2.5 sm:py-2"
                      >
                        <p className="text-[10px] font-medium leading-none text-muted-foreground">
                          {c.label}
                        </p>
                        <p className="mt-1 break-words text-xs leading-snug text-foreground/95">{c.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                交辦事項
              </p>
              <ul className="mt-2 list-none space-y-2 text-foreground/95">
                {(row.meeting_minute_assignments ?? [])
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((a) => (
                    <li
                      key={a.id}
                      className="rounded-lg border border-border/50 bg-background/50 px-3 py-2"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                        <p className="min-w-0 flex-1 font-medium leading-snug">{a.content}</p>
                        {a.assignee_ids?.length ? (
                          <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-muted-foreground sm:max-w-[min(100%,22rem)] sm:text-right">
                            {a.assignee_ids.map((eid) => {
                              const name = staffNameById.get(eid) ?? "…";
                              const st = (a.meeting_minute_assignee_status ?? []).find(
                                (s) => s.employee_id === eid,
                              );
                              const done = st?.completed ?? false;
                              return (
                                <span key={eid} className="inline-flex items-center gap-1 whitespace-nowrap">
                                  <span className="text-foreground/90">{name}</span>
                                  <span
                                    className={cn(
                                      "rounded px-1.5 py-0.5 font-medium",
                                      done
                                        ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                                        : "bg-amber-500/12 text-amber-900 dark:text-amber-100",
                                    )}
                                  >
                                    {done ? "已完成" : "待辦"}
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground sm:shrink-0">—</span>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
            <DetailBlock label="反應事項" text={row.feedback_notes} />
            <DetailBlock label="討論事項" text={row.discussion_notes} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                出席
              </p>
              <p className="mt-1 text-foreground/95">
                {(row.meeting_minute_attendees ?? [])
                  .map((x) => staffNameById.get(x.employee_id) ?? "…")
                  .join("、") || "—"}
              </p>
            </div>
            {atts.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  附件
                </p>
                <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {atts.map((att) =>
                    att.public_url ? (
                      <li key={att.id}>
                        <a
                          href={att.public_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block overflow-hidden rounded-lg border border-border/60"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={att.public_url}
                            alt="開會附件"
                            className="aspect-square w-full object-cover"
                          />
                        </a>
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      </li>
    );
  };

  return (
    <section
      className={cn(
        "rounded-2xl border border-border/90 bg-card p-6 shadow-sm sm:p-8",
        "ring-1 ring-border/30",
      )}
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight sm:text-xl">開會紀錄</h3>
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
              預設顯示最近 {MEETING_HISTORY_VISIBLE_FIRST} 筆，其餘可展開；點「填寫」新增一筆。
            </p>
          </div>
        </div>
        <Button
          type="button"
          className="shrink-0 gap-2 self-start sm:self-auto"
          onClick={() => {
            setEditMinuteId(null);
            setFormOpen(true);
          }}
        >
          填寫
        </Button>
      </div>

      <div>
        {!isSupabaseConfigured ? (
          <p className="text-sm text-muted-foreground">連線 Supabase 後可檢視與新增開會紀錄。</p>
        ) : listLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            載入中…
          </p>
        ) : listError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <p>{listError}</p>
            {listHint && showAdminHints ? (
              <p className="mt-2 text-xs text-muted-foreground">{listHint}</p>
            ) : null}
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚無紀錄。請點「填寫」新增。</p>
        ) : (
          <>
            <ul className="space-y-3">
              {list.slice(0, MEETING_HISTORY_VISIBLE_FIRST).map((row) => renderOneHistoryRow(row))}
            </ul>
            {list.length > MEETING_HISTORY_VISIBLE_FIRST ? (
              <details className="group mt-3 rounded-xl border border-border/60 bg-muted/10 open:bg-muted/15">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted/20 [&::-webkit-details-marker]:hidden">
                  <span>展開其餘 {list.length - MEETING_HISTORY_VISIBLE_FIRST} 筆紀錄</span>
                  <ChevronDown
                    className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <ul className="space-y-3 border-t border-border/40 px-3 pb-3 pt-3">
                  {list.slice(MEETING_HISTORY_VISIBLE_FIRST).map((row) => renderOneHistoryRow(row))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </div>

      <Dialog.Root
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditMinuteId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(92vh,48rem)] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl focus:outline-none sm:max-w-3xl sm:w-[calc(100%-2rem)]">
            <div className="shrink-0 border-b border-border/70 bg-secondary/15 px-4 py-3 sm:px-5 sm:py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Dialog.Title className="text-base font-semibold text-foreground sm:text-lg">
                    {editMinuteId ? "編輯開會紀錄" : "填寫開會紀錄"}
                  </Dialog.Title>
                  <Dialog.Description className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">
                    {showAdminHints
                      ? isSupabaseConfigured
                        ? "送出後寫入 employees schema；圖片上傳至 meeting-minutes。"
                        : "未連線時送出僅為示意。"
                      : isSupabaseConfigured
                        ? "送出後儲存紀錄與圖片。"
                        : "未連線時送出僅為示意。"}
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
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="mm-recorder"
                      className="mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground"
                    >
                      <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      紀錄人員
                    </label>
                    <select
                      id="mm-recorder"
                      value={recorderId}
                      onChange={(e) => setRecorderId(e.target.value)}
                      disabled={staffLoading || (!recorderOptions.length && isSupabaseConfigured)}
                      className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                    >
                      {recorderOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    {staffLoading ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">載入員工清單中…</p>
                    ) : null}
                  </div>
                  <div>
                    <label
                      htmlFor="mm-date"
                      className="mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground"
                    >
                      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      開會日期
                    </label>
                    <input
                      id="mm-date"
                      type="date"
                      value={meetingDate}
                      onChange={(e) => setMeetingDate(e.target.value)}
                      className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">出席人員（在職）</p>
                  <div
                    className={cn(
                      "max-h-40 overflow-y-auto rounded-xl border border-border/70 bg-muted/15 p-3 sm:max-h-48",
                      "[scrollbar-gutter:stable]",
                    )}
                  >
                    {staff.length === 0 && !staffLoading ? (
                      <p className="text-sm text-muted-foreground">
                        {isSupabaseConfigured ? "尚無在職員工資料。" : "連線後將顯示可勾選名單。"}
                      </p>
                    ) : (
                      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {staff.map((s) => {
                          const checked = attendeeIds.has(s.id);
                          return (
                            <li key={s.id}>
                              <label
                                className={cn(
                                  "flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-1.5",
                                  "hover:bg-muted/40",
                                  checked && "border-primary/25 bg-primary/5",
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleAttendee(s.id)}
                                  className="size-4 shrink-0 rounded border-input text-primary focus:ring-ring"
                                />
                                <span className="min-w-0 truncate text-sm">{s.name}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="mm-announce" className="mb-1.5 block text-sm font-medium text-foreground">
                    公告事項
                  </label>
                  <textarea
                    id="mm-announce"
                    rows={3}
                    value={announcements}
                    onChange={(e) => setAnnouncements(e.target.value)}
                    placeholder="填寫本週公告…"
                    className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div>
                  <label htmlFor="mm-weekly" className="mb-1.5 block text-sm font-medium text-foreground">
                    本週工作事項說明
                  </label>
                  <textarea
                    id="mm-weekly"
                    rows={3}
                    value={weeklyWorkNotes}
                    onChange={(e) => setWeeklyWorkNotes(e.target.value)}
                    placeholder="本週工作重點與進度…"
                    className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">交辦事項</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={addAssignmentRow}
                    >
                      新增一列
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {assignments.map((row) => (
                      <div
                        key={row.localId}
                        className="rounded-xl border border-border/70 bg-muted/10 p-3 sm:p-4"
                      >
                        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                          <input
                            type="text"
                            value={row.text}
                            onChange={(e) =>
                              setAssignments((rows) =>
                                rows.map((r) =>
                                  r.localId === row.localId ? { ...r, text: e.target.value } : r,
                                ),
                              )
                            }
                            placeholder="單行交辦內容…"
                            className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                          {assignments.length > 1 ? (
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-8 shrink-0 px-2 text-xs text-muted-foreground"
                              onClick={() => removeAssignmentRow(row.localId)}
                            >
                              移除此列
                            </Button>
                          ) : null}
                        </div>
                        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          負責人
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-2">
                          {staff.map((s) => {
                            const on = row.assigneeIds.includes(s.id);
                            return (
                              <label
                                key={s.id}
                                className={cn(
                                  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                                  on ? "border-primary/35 bg-primary/8" : "border-border/60 bg-background/80",
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() => toggleAssignmentAssignee(row, s.id)}
                                  className="size-3.5 rounded border-input text-primary"
                                />
                                {s.name}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="mm-feedback" className="mb-1.5 block text-sm font-medium text-foreground">
                    反應事項
                  </label>
                  <textarea
                    id="mm-feedback"
                    rows={2}
                    value={feedbackNotes}
                    onChange={(e) => setFeedbackNotes(e.target.value)}
                    placeholder="同仁反應或待回覆事項…"
                    className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div>
                  <label htmlFor="mm-discuss" className="mb-1.5 block text-sm font-medium text-foreground">
                    討論事項
                  </label>
                  <textarea
                    id="mm-discuss"
                    rows={2}
                    value={discussionNotes}
                    onChange={(e) => setDiscussionNotes(e.target.value)}
                    placeholder="會中討論摘要…"
                    className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4 dark:bg-amber-500/10">
                  <div className="mb-3 flex items-start gap-2">
                    <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-amber-800 dark:text-amber-200" aria-hidden />
                    <div>
                      <p className="text-sm font-medium text-foreground">週五工坊維護輪替</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        由紀錄人員設定；儀表板會顯示「最近一次開會日期」的名單。
                      </p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        立式機具保養（2 人）
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-2">
                        {staff.map((s) => {
                          const on = rotationVertical.includes(s.id);
                          return (
                            <label
                              key={`rv-${s.id}`}
                              className={cn(
                                "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                                on ? "border-primary/35 bg-primary/8" : "border-border/60 bg-background/80",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleRotationVertical(s.id)}
                                className="size-3.5 rounded border-input text-primary"
                              />
                              {s.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        手工機具保養（1 人）
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-2">
                        {staff.map((s) => {
                          const on = rotationHand.includes(s.id);
                          return (
                            <label
                              key={`rh-${s.id}`}
                              className={cn(
                                "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                                on ? "border-primary/35 bg-primary/8" : "border-border/60 bg-background/80",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleRotationHand(s.id)}
                                className="size-3.5 rounded border-input text-primary"
                              />
                              {s.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        機動監督（1 人）
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-2">
                        {staff.map((s) => {
                          const on = rotationSupervisor.includes(s.id);
                          return (
                            <label
                              key={`rs-${s.id}`}
                              className={cn(
                                "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                                on ? "border-primary/35 bg-primary/8" : "border-border/60 bg-background/80",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleRotationSupervisor(s.id)}
                                className="size-3.5 rounded border-input text-primary"
                              />
                              {s.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        值日生（1 人）
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-2">
                        {staff.map((s) => {
                          const on = rotationDuty.includes(s.id);
                          return (
                            <label
                              key={`rd-${s.id}`}
                              className={cn(
                                "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                                on ? "border-primary/35 bg-primary/8" : "border-border/60 bg-background/80",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleRotationDuty(s.id)}
                                className="size-3.5 rounded border-input text-primary"
                              />
                              {s.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">開會文件（圖片，可多張）</p>
                  {keptExistingAttachments.length > 0 ? (
                    <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {keptExistingAttachments.map((k) =>
                        k.public_url ? (
                          <li
                            key={k.id}
                            className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/20"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={k.public_url}
                              alt=""
                              className="aspect-square w-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => removeExistingAttachment(k.id)}
                              className="absolute right-1 top-1 rounded-md bg-background/90 px-2 py-0.5 text-[10px] font-medium shadow"
                            >
                              移除
                            </button>
                          </li>
                        ) : null,
                      )}
                    </ul>
                  ) : null}
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-muted/15 px-4 py-5 text-center transition-colors hover:bg-muted/25">
                    <ImagePlus className="h-7 w-7 text-muted-foreground" aria-hidden />
                    <span className="text-xs text-muted-foreground sm:text-sm">點擊選擇（送出時上傳）</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      onChange={(e) => void onPickImages(e.target.files)}
                    />
                  </label>
                  {pendingImages.length > 0 ? (
                    <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {pendingImages.map((img, idx) => (
                        <li
                          key={`${img.previewUrl}-${idx}`}
                          className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/20"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.previewUrl}
                            alt=""
                            className="aspect-square w-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => removePendingImage(idx)}
                            className="absolute right-1 top-1 rounded-md bg-background/90 px-2 py-0.5 text-[10px] font-medium shadow"
                          >
                            移除
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-4">
                  <Dialog.Close asChild>
                    <Button type="button" variant="outline" disabled={submitting}>
                      取消
                    </Button>
                  </Dialog.Close>
                  <Button type="submit" disabled={submitting} className="min-w-[7rem] gap-2">
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        儲存中…
                      </>
                    ) : editMinuteId ? (
                      "更新紀錄"
                    ) : (
                      "儲存紀錄"
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

function DetailBlock({ label, text }: { label: string; text: string | null }) {
  const t = text?.trim();
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-foreground/95">{t ? t : "—"}</p>
    </div>
  );
}
