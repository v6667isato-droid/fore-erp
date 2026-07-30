import { supabase } from "@/lib/supabase";

/** 盤點交辦任務（stocktake_tasks）：顯示於員工儀表板交辦事項，點開即盤點視窗 */
export interface StocktakeTaskRow {
  id: string;
  assignee_id: string;
  /** 限定盤點分類；null＝全部零件 */
  category: string | null;
  /** 自選盤點零件清單；非空時優先於 category */
  part_ids: string[] | null;
  instructions: string | null;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string | null;
}

export async function fetchStocktakeTasksForEmployee(
  employeeId: string,
): Promise<{ ok: true; rows: StocktakeTaskRow[] } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("stocktake_tasks")
    .select("id, assignee_id, category, part_ids, instructions, due_date, completed, completed_at, created_at")
    .eq("assignee_id", employeeId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, message: error.message };
  return { ok: true, rows: (data as StocktakeTaskRow[]) ?? [] };
}

export async function setStocktakeTaskCompleted(params: {
  taskId: string;
  completed: boolean;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase
    .from("stocktake_tasks")
    .update({
      completed: params.completed,
      completed_at: params.completed ? new Date().toISOString() : null,
    })
    .eq("id", params.taskId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
