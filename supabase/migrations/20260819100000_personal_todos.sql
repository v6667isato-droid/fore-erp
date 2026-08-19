-- 員工個人待辦：personal_todos（員工於儀表板「交辦事項」自行新增給自己）
CREATE TABLE IF NOT EXISTS public.personal_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  content text NOT NULL,
  due_date date,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.personal_todos IS '員工自建待辦事項；顯示於員工儀表板「交辦事項」清單';

CREATE INDEX IF NOT EXISTS personal_todos_employee_created_idx ON public.personal_todos (employee_id, created_at DESC);

-- 操作稽核：沿用 log_audit()（20260806100000_audit_logs.sql）
DROP TRIGGER IF EXISTS audit_personal_todos ON public.personal_todos;
CREATE TRIGGER audit_personal_todos
  AFTER INSERT OR UPDATE OR DELETE ON public.personal_todos
  FOR EACH ROW
  EXECUTE FUNCTION public.log_audit();

ALTER TABLE public.personal_todos ENABLE ROW LEVEL SECURITY;

-- 同 stocktake_tasks：登入者皆可操作（儀表板僅撈自己的）
DROP POLICY IF EXISTS "personal_todos_authenticated_all" ON public.personal_todos;
CREATE POLICY "personal_todos_authenticated_all" ON public.personal_todos FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_todos TO authenticated;
