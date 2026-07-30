import { supabase } from "@/lib/supabase";

/** 製作零件交辦的品項快照（建立當下的零件資訊，避免之後主檔改名影響顯示） */
export interface PartMakeTaskItem {
  part_id: string;
  part_no: string;
  name: string;
  unit: string;
  quantity: number;
}

/** 製作零件交辦（part_make_tasks）：完成回報時寫「進料」入庫 */
export interface PartMakeTaskRow {
  id: string;
  assignee_id: string;
  items: PartMakeTaskItem[];
  instructions: string | null;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string | null;
}

function normalizeItems(raw: unknown): PartMakeTaskItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (it): it is PartMakeTaskItem =>
      it != null &&
      typeof it === "object" &&
      typeof (it as PartMakeTaskItem).part_id === "string" &&
      typeof (it as PartMakeTaskItem).quantity === "number",
  );
}

export async function fetchPartMakeTasksForEmployee(
  employeeId: string,
): Promise<{ ok: true; rows: PartMakeTaskRow[] } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("part_make_tasks")
    .select("id, assignee_id, items, instructions, due_date, completed, completed_at, created_at")
    .eq("assignee_id", employeeId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, message: error.message };
  const rows: PartMakeTaskRow[] = (data ?? []).map((r) => ({
    ...(r as Omit<PartMakeTaskRow, "items">),
    items: normalizeItems((r as { items: unknown }).items),
  }));
  return { ok: true, rows };
}

export async function setPartMakeTaskCompleted(params: {
  taskId: string;
  completed: boolean;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase
    .from("part_make_tasks")
    .update({
      completed: params.completed,
      completed_at: params.completed ? new Date().toISOString() : null,
    })
    .eq("id", params.taskId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * 完成回報：依實際完成量寫入「進料」入庫（僅 >0 的品項），並標記任務完成。
 * 先寫入庫再標記完成；入庫失敗則不動任務狀態。
 */
export async function completePartMakeTask(params: {
  taskId: string;
  employeeId: string | null;
  completions: { part_id: string; actual: number }[];
}): Promise<{ ok: true; movements: number } | { ok: false; message: string }> {
  const rows = params.completions
    .filter((c) => Number.isFinite(c.actual) && c.actual > 0)
    .map((c) => ({
      part_id: c.part_id,
      movement_type: "進料",
      quantity: c.actual,
      employee_id: params.employeeId,
      notes: "製作交辦完成入庫",
    }));
  if (rows.length > 0) {
    const { error } = await supabase.from("stock_movements").insert(rows);
    if (error) return { ok: false, message: error.message };
  }
  const r = await setPartMakeTaskCompleted({ taskId: params.taskId, completed: true });
  if (!r.ok) return { ok: false, message: `已入庫，但任務狀態更新失敗：${r.message}` };
  return { ok: true, movements: rows.length };
}
