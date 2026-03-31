import imageCompression from "browser-image-compression";
import { supabase } from "@/lib/supabase";

export const MEETING_MINUTES_BUCKET = "meeting-minutes";

const DOC_IMAGE_OPTIONS = {
  maxSizeMB: 2,
  maxWidthOrHeight: 2880,
  initialQuality: 0.92,
  useWebWorker: true,
} as const;

export interface ActiveEmployeeOption {
  id: string;
  name: string;
}

export interface MeetingMinuteAssignmentInput {
  content: string;
  assigneeIds: string[];
}

export interface MeetingMinuteAttachmentRow {
  id: string;
  storage_path: string;
  public_url: string | null;
  sort_order: number;
}

export interface MeetingMinuteAssigneeStatusRow {
  employee_id: string;
  completed: boolean;
  updated_at: string;
}

export interface MeetingMinuteListRow {
  id: string;
  recorder_id: string;
  meeting_date: string;
  announcements: string | null;
  weekly_work_notes: string | null;
  feedback_notes: string | null;
  discussion_notes: string | null;
  /** 週五工坊輪替（uuid[]，欄位可能尚未 migration） */
  workshop_rotation_vertical?: string[] | null;
  workshop_rotation_hand?: string[] | null;
  workshop_rotation_supervisor?: string[] | null;
  workshop_rotation_duty?: string[] | null;
  created_at: string;
  meeting_minute_attendees: { employee_id: string }[];
  meeting_minute_assignments: {
    id: string;
    content: string;
    assignee_ids: string[] | null;
    sort_order: number;
    meeting_minute_assignee_status?: MeetingMinuteAssigneeStatusRow[] | null;
  }[];
  meeting_minute_attachments: MeetingMinuteAttachmentRow[];
}

/** 儀表板：最近一次開會紀錄上的工坊輪替（依 meeting_date 最新一筆） */
export interface WorkshopRotationDisplay {
  meetingDate: string;
  vertical: { id: string; name: string }[];
  hand: { id: string; name: string }[];
  supervisor: { id: string; name: string }[];
  duty: { id: string; name: string }[];
}

export interface WorkshopRotationPayload {
  vertical: string[];
  hand: string[];
  supervisor: string[];
  duty: string[];
}

function normalizeUuidArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean);
}

function trimWorkshopRotationPayload(p: WorkshopRotationPayload): WorkshopRotationPayload {
  return {
    vertical: normalizeUuidArray(p.vertical).slice(0, 2),
    hand: normalizeUuidArray(p.hand).slice(0, 1),
    supervisor: normalizeUuidArray(p.supervisor).slice(0, 1),
    duty: normalizeUuidArray(p.duty).slice(0, 1),
  };
}

export interface MeetingAssignmentForEmployeeRow {
  assignment_id: string;
  content: string;
  sort_order: number;
  meeting_minute_id: string;
  meeting_date: string;
  /** 目前登入者在此交辦的完成狀態（無列視為 false） */
  completed: boolean;
  status_updated_at: string | null;
}

export async function fetchActiveEmployeesForMeeting(): Promise<
  { ok: true; rows: ActiveEmployeeOption[] } | { ok: false; message: string }
> {
  const { data, error } = await supabase
    .from("employees")
    .select("id, name, employment_status")
    .eq("employment_status", true)
    .order("name", { ascending: true });

  if (error) {
    return { ok: false, message: error.message };
  }

  const rows = (data ?? []).map((r) => ({
    id: String((r as { id: string }).id),
    name: String((r as { name?: string }).name ?? ""),
  }));
  return { ok: true, rows };
}

export async function fetchMeetingMinutesList(limit = 40): Promise<
  { ok: true; rows: MeetingMinuteListRow[] } | { ok: false; message: string }
> {
  const { data, error } = await supabase
    .schema("employees")
    .from("meeting_minutes")
    .select(
      `
      id,
      recorder_id,
      meeting_date,
      announcements,
      weekly_work_notes,
      feedback_notes,
      discussion_notes,
      workshop_rotation_vertical,
      workshop_rotation_hand,
      workshop_rotation_supervisor,
      workshop_rotation_duty,
      created_at,
      meeting_minute_attendees(employee_id),
      meeting_minute_assignments(
        id,
        content,
        assignee_ids,
        sort_order,
        meeting_minute_assignee_status(employee_id, completed, updated_at)
      ),
      meeting_minute_attachments(id, storage_path, public_url, sort_order)
    `,
    )
    .order("meeting_date", { ascending: false })
    .limit(limit);

  if (error) {
    return { ok: false, message: error.message };
  }

  const rows = (data ?? []) as unknown as MeetingMinuteListRow[];
  return { ok: true, rows };
}

function isSchemaOrRelationError(msg: string): boolean {
  return /schema|relation|does not exist|Could not find/i.test(msg);
}

export async function fetchMeetingMinutesListSafe(limit = 40): Promise<
  { ok: true; rows: MeetingMinuteListRow[] } | { ok: false; message: string; hint?: string }
> {
  const r = await fetchMeetingMinutesList(limit);
  if (!r.ok && isSchemaOrRelationError(r.message)) {
    return {
      ok: false,
      message: r.message,
      hint:
        "若已執行 migration，請至 Supabase Dashboard → Settings → API → Exposed schemas 加入「employees」。",
    };
  }
  return r;
}

export async function fetchLatestWorkshopRotation(): Promise<
  { ok: true; data: WorkshopRotationDisplay | null } | { ok: false; message: string }
> {
  const { data, error } = await supabase
    .schema("employees")
    .from("meeting_minutes")
    .select(
      "meeting_date, workshop_rotation_vertical, workshop_rotation_hand, workshop_rotation_supervisor, workshop_rotation_duty",
    )
    .order("meeting_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message };
  }
  if (!data) {
    return { ok: true, data: null };
  }

  const row = data as Record<string, unknown>;
  const md =
    typeof row.meeting_date === "string"
      ? row.meeting_date.slice(0, 10)
      : String(row.meeting_date ?? "").slice(0, 10);

  const vertical = normalizeUuidArray(row.workshop_rotation_vertical);
  const hand = normalizeUuidArray(row.workshop_rotation_hand);
  const supervisor = normalizeUuidArray(row.workshop_rotation_supervisor);
  const duty = normalizeUuidArray(row.workshop_rotation_duty);

  const unique = [...new Set([...vertical, ...hand, ...supervisor, ...duty])];

  if (unique.length === 0) {
    return {
      ok: true,
      data: {
        meetingDate: md,
        vertical: [],
        hand: [],
        supervisor: [],
        duty: [],
      },
    };
  }

  const { data: emps, error: empErr } = await supabase
    .from("employees")
    .select("id, name")
    .in("id", unique);

  if (empErr) {
    return { ok: false, message: empErr.message };
  }

  const nameById = new Map(
    (emps ?? []).map((e) => {
      const r = e as { id: string; name?: string };
      return [r.id, String(r.name ?? "")] as const;
    }),
  );

  const mapNamed = (ids: string[]) =>
    ids.map((id) => ({ id, name: nameById.get(id)?.trim() || "（未知）" }));

  return {
    ok: true,
    data: {
      meetingDate: md,
      vertical: mapNamed(vertical),
      hand: mapNamed(hand),
      supervisor: mapNamed(supervisor),
      duty: mapNamed(duty),
    },
  };
}

export async function fetchLatestWorkshopRotationSafe(): Promise<
  | { ok: true; data: WorkshopRotationDisplay | null }
  | { ok: false; message: string; hint?: string }
> {
  const r = await fetchLatestWorkshopRotation();
  if (!r.ok && isSchemaOrRelationError(r.message)) {
    return {
      ok: false,
      message: r.message,
      hint:
        "若已執行 migration，請至 Supabase Dashboard → Settings → API → Exposed schemas 加入「employees」。",
    };
  }
  return r;
}

export interface InsertMeetingMinuteParams {
  recorderId: string;
  meetingDate: string;
  attendeeIds: string[];
  announcements: string;
  weeklyWorkNotes: string;
  feedbackNotes: string;
  discussionNotes: string;
  /** 週五工坊維護輪替（由紀錄人員於開會表單維護） */
  workshopRotation: WorkshopRotationPayload;
  assignments: MeetingMinuteAssignmentInput[];
  createdByUserId: string | null;
  imageFiles: File[];
}

export async function insertMeetingMinute(
  params: InsertMeetingMinuteParams,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const {
    recorderId,
    meetingDate,
    attendeeIds,
    announcements,
    weeklyWorkNotes,
    feedbackNotes,
    discussionNotes,
    workshopRotation,
    assignments,
    createdByUserId,
    imageFiles,
  } = params;

  const wr = trimWorkshopRotationPayload(workshopRotation);

  const { data: ins, error: insErr } = await supabase
    .schema("employees")
    .from("meeting_minutes")
    .insert({
      recorder_id: recorderId,
      meeting_date: meetingDate,
      announcements: announcements.trim() || null,
      weekly_work_notes: weeklyWorkNotes.trim() || null,
      feedback_notes: feedbackNotes.trim() || null,
      discussion_notes: discussionNotes.trim() || null,
      workshop_rotation_vertical: wr.vertical,
      workshop_rotation_hand: wr.hand,
      workshop_rotation_supervisor: wr.supervisor,
      workshop_rotation_duty: wr.duty,
      created_by_user_id: createdByUserId,
    })
    .select("id")
    .single();

  if (insErr || !ins?.id) {
    return { ok: false, message: insErr?.message ?? "無法建立開會紀錄" };
  }

  const minuteId = String(ins.id);

  if (attendeeIds.length > 0) {
    const { error: attErr } = await supabase
      .schema("employees")
      .from("meeting_minute_attendees")
      .insert(attendeeIds.map((employee_id) => ({ meeting_minute_id: minuteId, employee_id })));
    if (attErr) {
      return { ok: false, message: `出席者寫入失敗：${attErr.message}` };
    }
  }

  const assignmentRows = assignments
    .map((a, i) => ({
      meeting_minute_id: minuteId,
      content: a.content.trim(),
      assignee_ids: a.assigneeIds,
      sort_order: i,
    }))
    .filter((r) => r.content.length > 0);

  if (assignmentRows.length > 0) {
    const { error: asgErr } = await supabase
      .schema("employees")
      .from("meeting_minute_assignments")
      .insert(assignmentRows);
    if (asgErr) {
      return { ok: false, message: `交辦事項寫入失敗：${asgErr.message}` };
    }
  }

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i];
    if (!file.type.startsWith("image/")) {
      return { ok: false, message: "僅支援圖片檔案" };
    }
    const compressed = await imageCompression(file, DOC_IMAGE_OPTIONS);
    const ext = compressed.name.split(".").pop()?.toLowerCase() || "webp";
    const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "webp";
    const path = `${minuteId}/${crypto.randomUUID()}.${safeExt}`;
    const { data: up, error: upErr } = await supabase.storage
      .from(MEETING_MINUTES_BUCKET)
      .upload(path, compressed, { cacheControl: "3600", upsert: false });
    if (upErr || !up?.path) {
      return { ok: false, message: `圖片上傳失敗：${upErr?.message ?? ""}` };
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from(MEETING_MINUTES_BUCKET).getPublicUrl(up.path);

    const { error: attRowErr } = await supabase
      .schema("employees")
      .from("meeting_minute_attachments")
      .insert({
        meeting_minute_id: minuteId,
        storage_path: up.path,
        public_url: publicUrl,
        sort_order: i,
      });
    if (attRowErr) {
      return { ok: false, message: `附件紀錄寫入失敗：${attRowErr.message}` };
    }
  }

  return { ok: true, id: minuteId };
}

export async function fetchMeetingAssignmentsForEmployee(
  employeeId: string,
): Promise<
  { ok: true; rows: MeetingAssignmentForEmployeeRow[] } | { ok: false; message: string }
> {
  const { data, error } = await supabase
    .schema("employees")
    .from("meeting_minute_assignments")
    .select(
      `
      id,
      content,
      sort_order,
      meeting_minute_id,
      assignee_ids,
      meeting_minutes(meeting_date),
      meeting_minute_assignee_status(employee_id, completed, updated_at)
    `,
    )
    .contains("assignee_ids", [employeeId]);

  if (error) {
    return { ok: false, message: error.message };
  }

  const raw = (data ?? []) as {
    id: string;
    content: string;
    sort_order: number;
    meeting_minute_id: string;
    assignee_ids: string[] | null;
    meeting_minutes: { meeting_date: string } | { meeting_date: string }[] | null;
    meeting_minute_assignee_status:
      | { employee_id: string; completed: boolean; updated_at: string }[]
      | null;
  }[];

  const rows: MeetingAssignmentForEmployeeRow[] = raw.map((r) => {
    const mm = r.meeting_minutes;
    const md =
      mm == null
        ? ""
        : Array.isArray(mm)
          ? String(mm[0]?.meeting_date ?? "")
          : String(mm.meeting_date ?? "");
    const statuses = r.meeting_minute_assignee_status ?? [];
    const mine = statuses.find((s) => s.employee_id === employeeId);
    return {
      assignment_id: r.id,
      content: r.content,
      sort_order: r.sort_order,
      meeting_minute_id: r.meeting_minute_id,
      meeting_date: md.slice(0, 10),
      completed: mine?.completed ?? false,
      status_updated_at: mine?.updated_at ?? null,
    };
  });

  rows.sort((a, b) => {
    const d = b.meeting_date.localeCompare(a.meeting_date);
    if (d !== 0) return d;
    return a.sort_order - b.sort_order;
  });

  return { ok: true, rows };
}

export async function upsertMeetingAssignmentAssigneeStatus(params: {
  assignmentId: string;
  employeeId: string;
  completed: boolean;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { assignmentId, employeeId, completed } = params;
  const { error } = await supabase
    .schema("employees")
    .from("meeting_minute_assignee_status")
    .upsert(
      {
        assignment_id: assignmentId,
        employee_id: employeeId,
        completed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "assignment_id,employee_id" },
    );

  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

export interface KeptMeetingAttachment {
  storage_path: string;
  public_url: string;
}

export interface UpdateMeetingMinuteParams extends InsertMeetingMinuteParams {
  meetingMinuteId: string;
  /** 編輯時保留的既有附件（其餘舊檔將自 Storage 刪除） */
  keptAttachments: KeptMeetingAttachment[];
}

export async function updateMeetingMinute(
  params: UpdateMeetingMinuteParams,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const {
    meetingMinuteId,
    recorderId,
    meetingDate,
    attendeeIds,
    announcements,
    weeklyWorkNotes,
    feedbackNotes,
    discussionNotes,
    workshopRotation,
    assignments,
    createdByUserId,
    imageFiles,
    keptAttachments,
  } = params;

  const wr = trimWorkshopRotationPayload(workshopRotation);

  const { error: upErr } = await supabase
    .schema("employees")
    .from("meeting_minutes")
    .update({
      recorder_id: recorderId,
      meeting_date: meetingDate,
      announcements: announcements.trim() || null,
      weekly_work_notes: weeklyWorkNotes.trim() || null,
      feedback_notes: feedbackNotes.trim() || null,
      discussion_notes: discussionNotes.trim() || null,
      workshop_rotation_vertical: wr.vertical,
      workshop_rotation_hand: wr.hand,
      workshop_rotation_supervisor: wr.supervisor,
      workshop_rotation_duty: wr.duty,
      created_by_user_id: createdByUserId,
    })
    .eq("id", meetingMinuteId);

  if (upErr) {
    return { ok: false, message: upErr.message };
  }

  const { data: oldAtts, error: oldErr } = await supabase
    .schema("employees")
    .from("meeting_minute_attachments")
    .select("storage_path")
    .eq("meeting_minute_id", meetingMinuteId);

  if (oldErr) {
    return { ok: false, message: oldErr.message };
  }

  const keepPaths = new Set(keptAttachments.map((k) => k.storage_path));
  const toRemove = (oldAtts ?? [])
    .map((r) => String((r as { storage_path: string }).storage_path))
    .filter((p) => p && !keepPaths.has(p));

  if (toRemove.length > 0) {
    const { error: rmSt } = await supabase.storage.from(MEETING_MINUTES_BUCKET).remove(toRemove);
    if (rmSt) {
      return { ok: false, message: `刪除舊圖失敗：${rmSt.message}` };
    }
  }

  const { error: delAtt } = await supabase
    .schema("employees")
    .from("meeting_minute_attendees")
    .delete()
    .eq("meeting_minute_id", meetingMinuteId);
  if (delAtt) {
    return { ok: false, message: delAtt.message };
  }

  const { error: delAsg } = await supabase
    .schema("employees")
    .from("meeting_minute_assignments")
    .delete()
    .eq("meeting_minute_id", meetingMinuteId);
  if (delAsg) {
    return { ok: false, message: delAsg.message };
  }

  const { error: delAttRows } = await supabase
    .schema("employees")
    .from("meeting_minute_attachments")
    .delete()
    .eq("meeting_minute_id", meetingMinuteId);
  if (delAttRows) {
    return { ok: false, message: delAttRows.message };
  }

  if (attendeeIds.length > 0) {
    const { error: attErr } = await supabase
      .schema("employees")
      .from("meeting_minute_attendees")
      .insert(attendeeIds.map((employee_id) => ({ meeting_minute_id: meetingMinuteId, employee_id })));
    if (attErr) {
      return { ok: false, message: attErr.message };
    }
  }

  const assignmentRows = assignments
    .map((a, i) => ({
      meeting_minute_id: meetingMinuteId,
      content: a.content.trim(),
      assignee_ids: a.assigneeIds,
      sort_order: i,
    }))
    .filter((r) => r.content.length > 0);

  if (assignmentRows.length > 0) {
    const { error: asgErr } = await supabase
      .schema("employees")
      .from("meeting_minute_assignments")
      .insert(assignmentRows);
    if (asgErr) {
      return { ok: false, message: asgErr.message };
    }
  }

  let sortOrder = 0;
  for (const k of keptAttachments) {
    const { error: insK } = await supabase
      .schema("employees")
      .from("meeting_minute_attachments")
      .insert({
        meeting_minute_id: meetingMinuteId,
        storage_path: k.storage_path,
        public_url: k.public_url,
        sort_order: sortOrder++,
      });
    if (insK) {
      return { ok: false, message: insK.message };
    }
  }

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i];
    if (!file.type.startsWith("image/")) {
      return { ok: false, message: "僅支援圖片檔案" };
    }
    const compressed = await imageCompression(file, DOC_IMAGE_OPTIONS);
    const ext = compressed.name.split(".").pop()?.toLowerCase() || "webp";
    const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "webp";
    const path = `${meetingMinuteId}/${crypto.randomUUID()}.${safeExt}`;
    const { data: up, error: upErr } = await supabase.storage
      .from(MEETING_MINUTES_BUCKET)
      .upload(path, compressed, { cacheControl: "3600", upsert: false });
    if (upErr || !up?.path) {
      return { ok: false, message: `圖片上傳失敗：${upErr?.message ?? ""}` };
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from(MEETING_MINUTES_BUCKET).getPublicUrl(up.path);

    const { error: attRowErr } = await supabase
      .schema("employees")
      .from("meeting_minute_attachments")
      .insert({
        meeting_minute_id: meetingMinuteId,
        storage_path: up.path,
        public_url: publicUrl,
        sort_order: sortOrder++,
      });
    if (attRowErr) {
      return { ok: false, message: attRowErr.message };
    }
  }

  return { ok: true };
}

export async function deleteMeetingMinute(
  meetingMinuteId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: paths, error: qErr } = await supabase
    .schema("employees")
    .from("meeting_minute_attachments")
    .select("storage_path")
    .eq("meeting_minute_id", meetingMinuteId);

  if (qErr) {
    return { ok: false, message: qErr.message };
  }

  const toRemove = (paths ?? [])
    .map((r) => String((r as { storage_path: string }).storage_path))
    .filter(Boolean);

  if (toRemove.length > 0) {
    const { error: rmSt } = await supabase.storage.from(MEETING_MINUTES_BUCKET).remove(toRemove);
    if (rmSt) {
      return { ok: false, message: `刪除附件檔案失敗：${rmSt.message}` };
    }
  }

  const { error } = await supabase
    .schema("employees")
    .from("meeting_minutes")
    .delete()
    .eq("id", meetingMinuteId);

  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}
