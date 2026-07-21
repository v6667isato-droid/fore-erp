import { supabase } from "@/lib/supabase";
import { fetchMeetingMinutesListSafe } from "@/lib/meeting-minutes";
import {
  fetchAllCompanyEventAssignees,
  type CompanyEventRow,
} from "@/lib/company-events";

export type CompanyAssignmentSource = "meeting" | "calendar";

/**
 * 管理端：某位員工的一筆公司交辦（開會交辦 / 行事曆交辦），
 * 不含生產交辦（work_orders / production_tasks）。
 */
export interface AdminCompanyAssignmentItem {
  key: string;
  source: CompanyAssignmentSource;
  employee_id: string;
  employee_name: string;
  content: string;
  description: string | null;
  date: string;
  completed: boolean;
  completed_at: string | null;
  /** 行事曆交辦：company_event_assignees 該筆 id，供勾選完成狀態 */
  assignee_row_id: string | null;
  /** 行事曆交辦：對應的 company_event，供編輯 modal 使用；開會交辦為 null */
  calendar_event: CompanyEventRow | null;
}

function normalizeAssigneeIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean);
}

/**
 * 彙整所有員工的公司交辦事項：
 * - 開會交辦：employees.meeting_minute_assignments（依 assignee_ids 展開，完成狀態取 meeting_minute_assignee_status）
 * - 行事曆交辦：company_event_assignees（join company_event）
 * 生產交辦不納入。
 */
export async function fetchAllCompanyAssignments(): Promise<
  { ok: true; items: AdminCompanyAssignmentItem[]; warning?: string } | { ok: false; message: string }
> {
  // 員工姓名對照（含離職，避免歷史交辦顯示為空）
  const nameById = new Map<string, string>();
  const { data: emps, error: empErr } = await supabase
    .from("employees")
    .select("id, name");
  if (empErr) {
    return { ok: false, message: `讀取員工資料失敗：${empErr.message}` };
  }
  for (const e of emps ?? []) {
    const r = e as { id?: string; name?: string };
    if (r.id) nameById.set(String(r.id), String(r.name ?? "").trim() || "（未命名）");
  }

  const items: AdminCompanyAssignmentItem[] = [];
  let warning: string | undefined;

  // 開會交辦
  const meetingRes = await fetchMeetingMinutesListSafe(80);
  if (!meetingRes.ok) {
    warning = meetingRes.hint
      ? `開會交辦讀取失敗：${meetingRes.message}（${meetingRes.hint}）`
      : `開會交辦讀取失敗：${meetingRes.message}`;
  } else {
    for (const minute of meetingRes.rows) {
      const meetingDate = String(minute.meeting_date ?? "").slice(0, 10);
      for (const asg of minute.meeting_minute_assignments ?? []) {
        const content = String(asg.content ?? "").trim();
        if (!content) continue;
        const assigneeIds = normalizeAssigneeIds(asg.assignee_ids);
        const statuses = asg.meeting_minute_assignee_status ?? [];
        for (const eid of assigneeIds) {
          const mine = statuses.find((s) => String(s.employee_id) === eid);
          items.push({
            key: `m-${asg.id}-${eid}`,
            source: "meeting",
            employee_id: eid,
            employee_name: nameById.get(eid) ?? "（未知員工）",
            content,
            description: null,
            date: meetingDate,
            completed: mine?.completed === true,
            completed_at: mine?.completed ? mine.updated_at ?? null : null,
            assignee_row_id: null,
            calendar_event: null,
          });
        }
      }
    }
  }

  // 行事曆交辦
  const calendarRes = await fetchAllCompanyEventAssignees();
  if (!calendarRes.ok) {
    const msg = `行事曆交辦讀取失敗：${calendarRes.message}`;
    warning = warning ? `${warning}；${msg}` : msg;
  } else {
    for (const c of calendarRes.rows) {
      const eid = String(c.employee_id);
      items.push({
        key: `c-${c.id}`,
        source: "calendar",
        employee_id: eid,
        employee_name: nameById.get(eid) ?? "（未知員工）",
        content: c.event_title || "（未命名事件）",
        description: c.event_description,
        date: String(c.event_date ?? "").slice(0, 10),
        completed: c.completed === true,
        completed_at: c.completed ? c.updated_at || null : null,
        assignee_row_id: c.id,
        calendar_event: {
          id: c.company_event_id,
          title: c.event_title,
          event_date: String(c.event_date ?? "").slice(0, 10),
          category: c.event_category,
          description: c.event_description,
        },
      });
    }
  }

  // 未完成優先、再依日期新到舊
  items.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return b.date.localeCompare(a.date);
  });

  return { ok: true, items, warning };
}
