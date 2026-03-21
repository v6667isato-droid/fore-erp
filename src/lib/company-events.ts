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

/** 員工儀表板「公司公告」：僅 company 類別；匿名 policy 亦只開放此類別 */
export async function fetchCompanyAnnouncementsFromEvents(): Promise<CompanyAnnouncementDto[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from(COMPANY_EVENT_TABLE)
    .select("id,title,description,event_date")
    .eq("category", "company")
    .order("event_date", { ascending: false })
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

export async function insertCompanyEvent(input: InsertCompanyEventInput): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase 未設定");
  }
  const { error } = await supabase.from(COMPANY_EVENT_TABLE).insert({
    title: input.title.trim(),
    event_date: input.event_date,
    category: input.category,
    description: input.description?.trim() ? input.description.trim() : null,
  });
  if (error) throw error;
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
  const { error } = await supabase
    .from(COMPANY_EVENT_TABLE)
    .update({
      title: input.title.trim(),
      event_date: input.event_date,
      category: input.category,
      description: input.description?.trim() ? input.description.trim() : null,
    })
    .eq("id", input.id);
  if (error) throw error;
}

export async function deleteCompanyEvent(id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase 未設定");
  }
  // 勿使用 .select()：在 RLS 下 RETURNING 常拿不到列，data 會是 [] 被誤判為失敗
  const { error } = await supabase.from(COMPANY_EVENT_TABLE).delete().eq("id", id);
  if (error) throw error;
}
