import { supabase } from "@/lib/supabase";

/** 員工個人待辦（personal_todos）：員工於儀表板「交辦事項」自行新增給自己 */
export interface PersonalTodoRow {
  id: string;
  employee_id: string;
  content: string;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string | null;
}

export async function fetchPersonalTodosForEmployee(
  employeeId: string,
): Promise<{ ok: true; rows: PersonalTodoRow[] } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("personal_todos")
    .select("id, employee_id, content, due_date, completed, completed_at, created_at")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, message: error.message };
  return { ok: true, rows: (data as PersonalTodoRow[]) ?? [] };
}

export async function createPersonalTodo(params: {
  employeeId: string;
  content: string;
  dueDate: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.from("personal_todos").insert({
    employee_id: params.employeeId,
    content: params.content,
    due_date: params.dueDate,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function setPersonalTodoCompleted(params: {
  todoId: string;
  completed: boolean;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase
    .from("personal_todos")
    .update({
      completed: params.completed,
      completed_at: params.completed ? new Date().toISOString() : null,
    })
    .eq("id", params.todoId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function deletePersonalTodo(
  todoId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.from("personal_todos").delete().eq("id", todoId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
