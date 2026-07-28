import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/** Supabase / Postgres 資料表名稱（單數）。舊表 `company_events` 已廢止，請勿使用。 */
export const COMPANY_EVENT_TABLE = "company_event" as const;

/** 公司公告列表（與員工儀表板 / 行事曆上方區塊共用） */
export interface CompanyAnnouncementDto {
  id: string;
  title: string;
  body: string;
  published_at: string;
}

export type CompanyEventCategory = "company" | "production" | "event" | "memo";

export interface CompanyEventRow {
  id: string;
  title: string;
  event_date: string;
  category: CompanyEventCategory;
  description: string | null;
  created_at?: string;
}

export const COMPANY_EVENT_CATEGORY_OPTIONS: {
  value: CompanyEventCategory;
  label: string;
}[] = [
  { value: "company", label: "公司" },
  { value: "production", label: "生產" },
  { value: "event", label: "事件" },
  { value: "memo", label: "備忘" },
];

export const companyEventCategoryLabel: Record<CompanyEventCategory, string> = {
  company: "公司",
  production: "生產",
  event: "事件",
  memo: "備忘",
};

export function companyEventBadgePrefix(category: CompanyEventCategory): string {
  return `[${companyEventCategoryLabel[category]}]`;
}

function isCompanyEventCategory(v: string): v is CompanyEventCategory {
  return v === "company" || v === "production" || v === "event" || v === "memo";
}

function normalizeRow(row: Record<string, unknown>): CompanyEventRow | null {
  const id = row.id;
  const title = row.title;
  const event_date = row.event_date;
  const category = row.category;
  if (typeof id !== "string" || typeof title !== "string" || typeof event_date !== "string") {
    return null;
  }
  if (typeof category !== "string" || !isCompanyEventCategory(category)) {
    return null;
  }
  const description = row.description;
  return {
    id,
    title,
    event_date,
    category,
    description: typeof description === "string" ? description : null,
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
  };
}

export async function fetchCompanyEventsBetween(
  startIsoDate: string,
  endIsoDate: string
): Promise<CompanyEventRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from("company_event")
    .select("id,title,event_date,category,description,created_at")
    .gte("event_date", startIsoDate)
    .lte("event_date", endIsoDate)
    .order("event_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((r) => normalizeRow(r as Record<string, unknown>)).filter(Boolean) as CompanyEventRow[];
}

/** 員工儀表板「公司公告」：僅 company 類別；匿名 policy 亦只開放此類別。只取今日（含）以後，由近到遠 */
export async function fetchCompanyAnnouncementsFromEvents(): Promise<CompanyAnnouncementDto[]> {
  if (!isSupabaseConfigured) return [];
  const t = new Date();
  const todayIso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
    t.getDate()
  ).padStart(2, "0")}`;
  const { data, error } = await supabase
    .from(COMPANY_EVENT_TABLE)
    .select("id,title,description,event_date")
    .eq("category", "company")
    .gte("event_date", todayIso)
    .order("event_date", { ascending: true })
    .limit(40);

  if (error) throw error;
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const title = typeof row.title === "string" ? row.title : "";
    const body = typeof row.description === "string" ? row.description : "";
    const published_at = typeof row.event_date === "string" ? row.event_date : "";
    return { id, title, body, published_at };
  });
}

export interface InsertCompanyEventInput {
  title: string;
  event_date: string;
  category: CompanyEventCategory;
  description: string | null;
}

export async function insertCompanyEvent(input: InsertCompanyEventInput): Promise<string> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase 未設定");
  }
  const { data, error } = await supabase
    .from(COMPANY_EVENT_TABLE)
    .insert({
      title: input.title.trim(),
      event_date: input.event_date,
      category: input.category,
      description: input.description?.trim() ? input.description.trim() : null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export interface UpdateCompanyEventInput {
  id: string;
  title: string;
  event_date: string;
  category: CompanyEventCategory;
  description: string | null;
}

export async function updateCompanyEvent(input: UpdateCompanyEventInput): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase 未設定");
  }
  const { error, count } = await supabase
    .from(COMPANY_EVENT_TABLE)
    .update(
      {
        title: input.title.trim(),
        event_date: input.event_date,
        category: input.category,
        description: input.description?.trim() ? input.description.trim() : null,
      },
      { count: "exact" },
    )
    .eq("id", input.id);
  if (error) throw error;
  if (count === 0) {
    throw new Error(
      "未更新任何資料（可能沒有 UPDATE 權限，或該筆已不存在）。請在 Supabase 確認 RLS policy 已開放 authenticated 角色的 UPDATE 權限。",
    );
  }
}

// ─── company_event_assignees ───

const CEA_TABLE = "company_event_assignees" as const;

export interface CompanyEventAssigneeRow {
  id: string;
  company_event_id: string;
  employee_id: string;
  completed: boolean;
  updated_at: string;
  /** joined from company_event */
  event_title: string;
  event_date: string;
  event_category: CompanyEventCategory;
  event_description: string | null;
  /** 交辦附圖（Telegram bot 上傳至 Storage task-images bucket 的公開 URL） */
  event_image_url: string | null;
}

/**
 * 交辦 description 可能含 Telegram bot 寫入的「附圖:URL」純文字行。
 * 回傳去除該行後的說明文字，以及圖片網址（優先取 image_url 欄位，其次從文字解析）。
 */
export function splitAssignmentImage(
  description: string | null,
  imageUrl: string | null,
): { text: string | null; imageUrl: string | null } {
  let url = imageUrl;
  let text = description ?? "";
  const m = text.match(/附圖[:：]\s*(https?:\/\/\S+)/);
  if (m) {
    if (!url) url = m[1];
    text = text.replace(m[0], "");
  }
  text = text.trim();
  return { text: text || null, imageUrl: url };
}

export async function insertCompanyEventAssignees(
  companyEventId: string,
  employeeIds: string[],
): Promise<void> {
  if (!isSupabaseConfigured || employeeIds.length === 0) return;
  const rows = employeeIds.map((eid) => ({
    company_event_id: companyEventId,
    employee_id: eid,
  }));
  const { error } = await supabase.from(CEA_TABLE).insert(rows);
  if (error) throw error;
}

export async function fetchCompanyEventAssignmentsForEmployee(
  employeeId: string,
): Promise<{ ok: true; rows: CompanyEventAssigneeRow[] } | { ok: false; message: string }> {
  if (!isSupabaseConfigured) return { ok: true, rows: [] };
  const { data, error } = await supabase
    .from(CEA_TABLE)
    .select(
      "id, company_event_id, employee_id, completed, updated_at, company_event(title, event_date, category, description, image_url)",
    )
    .eq("employee_id", employeeId)
    .order("updated_at", { ascending: false });

  if (error) return { ok: false, message: error.message };

  const rows: CompanyEventAssigneeRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const ev = (r.company_event ?? {}) as Record<string, unknown>;
    const cat = typeof ev.category === "string" && isCompanyEventCategory(ev.category)
      ? ev.category
      : "company";
    return {
      id: String(r.id ?? ""),
      company_event_id: String(r.company_event_id ?? ""),
      employee_id: String(r.employee_id ?? ""),
      completed: r.completed === true,
      updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
      event_title: typeof ev.title === "string" ? ev.title : "",
      event_date: typeof ev.event_date === "string" ? ev.event_date : "",
      event_category: cat,
      event_description: typeof ev.description === "string" ? ev.description : null,
      event_image_url: typeof ev.image_url === "string" ? ev.image_url : null,
    };
  });
  rows.sort((a, b) => a.event_date.localeCompare(b.event_date));
  return { ok: true, rows };
}

/** 管理端：所有行事曆交辦（不分員工），含員工與事件資訊。 */
export async function fetchAllCompanyEventAssignees(): Promise<
  { ok: true; rows: CompanyEventAssigneeRow[] } | { ok: false; message: string }
> {
  if (!isSupabaseConfigured) return { ok: true, rows: [] };
  const { data, error } = await supabase
    .from(CEA_TABLE)
    .select(
      "id, company_event_id, employee_id, completed, updated_at, company_event(title, event_date, category, description, image_url)",
    )
    .order("updated_at", { ascending: false });

  if (error) return { ok: false, message: error.message };

  const rows: CompanyEventAssigneeRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const ev = (r.company_event ?? {}) as Record<string, unknown>;
    const cat = typeof ev.category === "string" && isCompanyEventCategory(ev.category)
      ? ev.category
      : "company";
    return {
      id: String(r.id ?? ""),
      company_event_id: String(r.company_event_id ?? ""),
      employee_id: String(r.employee_id ?? ""),
      completed: r.completed === true,
      updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
      event_title: typeof ev.title === "string" ? ev.title : "",
      event_date: typeof ev.event_date === "string" ? ev.event_date : "",
      event_category: cat,
      event_description: typeof ev.description === "string" ? ev.description : null,
      event_image_url: typeof ev.image_url === "string" ? ev.image_url : null,
    };
  });
  return { ok: true, rows };
}

/** 多事件負責人姓名（employees.name），key = company_event_id */
export async function fetchAssigneeNamesForEvents(
  eventIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!isSupabaseConfigured || eventIds.length === 0) return map;
  const { data, error } = await supabase
    .from(CEA_TABLE)
    .select("company_event_id, employees(name)")
    .in("company_event_id", eventIds);
  if (error) throw error;
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const evId = String(r.company_event_id ?? "");
    const emp = (r.employees ?? null) as { name?: unknown } | null;
    const name = emp && typeof emp.name === "string" ? emp.name : "";
    if (!evId || !name) continue;
    const list = map.get(evId) ?? [];
    list.push(name);
    map.set(evId, list);
  }
  return map;
}

export async function fetchCompanyEventAssigneeIds(
  companyEventId: string,
): Promise<string[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from(CEA_TABLE)
    .select("employee_id")
    .eq("company_event_id", companyEventId);
  if (error) throw error;
  return (data ?? []).map((r) => String((r as { employee_id: string }).employee_id));
}

export async function syncCompanyEventAssignees(
  companyEventId: string,
  employeeIds: string[],
): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error: delErr } = await supabase
    .from(CEA_TABLE)
    .delete()
    .eq("company_event_id", companyEventId);
  if (delErr) throw delErr;
  if (employeeIds.length === 0) return;
  const rows = employeeIds.map((eid) => ({
    company_event_id: companyEventId,
    employee_id: eid,
  }));
  const { error: insErr } = await supabase.from(CEA_TABLE).insert(rows);
  if (insErr) throw insErr;
}

export async function upsertCompanyEventAssigneeCompleted(params: {
  assigneeRowId: string;
  completed: boolean;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isSupabaseConfigured) return { ok: false, message: "Supabase 未設定" };
  const { error } = await supabase
    .from(CEA_TABLE)
    .update({ completed: params.completed, updated_at: new Date().toISOString() })
    .eq("id", params.assigneeRowId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function deleteCompanyEvent(id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase 未設定");
  }
  // RLS 擋刪時 PostgREST 仍回 204、error 為 null，但實際刪除 0 筆；用 Prefer: count=exact 辨識
  const { error, count } = await supabase
    .from(COMPANY_EVENT_TABLE)
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) throw error;
  if (count === 0) {
    throw new Error(
      "未刪除任何資料（可能沒有 DELETE 權限，或該筆已不存在）。請在 Supabase 執行 migration：company_event_delete_authenticated，並確認已登入。"
    );
  }
}
