-- 工單生產狀態（stage）異動歷程：記錄何時、誰把工單從哪個階段改成哪個階段
-- 背景：work_orders.stage 目前僅單純覆寫，無 updated_at、也無稽核紀錄，
-- 員工改「備料→製作」等狀態時完全查不到異動時間與異動人。

-- 1. work_orders 補上 updated_at，任何欄位更新都會刷新
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.work_orders
SET updated_at = COALESCE(created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE public.work_orders
  ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.work_orders
  ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.work_orders_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_orders_set_updated_at ON public.work_orders;
CREATE TRIGGER work_orders_set_updated_at
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.work_orders_set_updated_at();

COMMENT ON COLUMN public.work_orders.updated_at IS '最後更新時間（任何欄位變更皆會刷新）';

-- 2. 歷程表：一筆 = 一次 stage 變更
CREATE TABLE IF NOT EXISTS public.work_order_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders (id) ON DELETE CASCADE,
  old_stage text,
  new_stage text NOT NULL,
  changed_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  changed_by_employee_id uuid REFERENCES public.employees (id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_order_stage_history_work_order_id_idx
  ON public.work_order_stage_history (work_order_id, changed_at DESC);

COMMENT ON TABLE public.work_order_stage_history IS '工單 stage 異動歷程，由 trigger 自動寫入，前端不應直接 insert';
COMMENT ON COLUMN public.work_order_stage_history.changed_by_user_id IS '異動當下的 auth.uid()（若有登入 session）';
COMMENT ON COLUMN public.work_order_stage_history.changed_by_employee_id IS '對應 public.employees.id，透過 user_profiles.employee_id 或 email 比對登入者解析';

-- 3. 解析目前登入者對應的 employees.id（比照 employees.is_meeting_assignee_actor 的判斷邏輯）
CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.employee_id
  FROM public.user_profiles up
  WHERE up.user_id = auth.uid()
    AND up.employee_id IS NOT NULL
  UNION ALL
  SELECT e.id
  FROM public.employees e
  INNER JOIN auth.users u ON u.id = auth.uid()
  WHERE e.email IS NOT NULL
    AND trim(e.email) <> ''
    AND u.email IS NOT NULL
    AND trim(u.email) <> ''
    AND lower(trim(e.email)) = lower(trim(u.email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_employee_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_employee_id() TO authenticated;

-- 4. Trigger：stage 變更時自動寫入歷程（含建立工單當下的初始 stage）
CREATE OR REPLACE FUNCTION public.work_orders_log_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.work_order_stage_history (
    work_order_id, old_stage, new_stage, changed_by_user_id, changed_by_employee_id
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage ELSE NULL END,
    NEW.stage,
    auth.uid(),
    public.current_employee_id()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_orders_log_stage_change_insert ON public.work_orders;
CREATE TRIGGER work_orders_log_stage_change_insert
  AFTER INSERT ON public.work_orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.work_orders_log_stage_change();

DROP TRIGGER IF EXISTS work_orders_log_stage_change_update ON public.work_orders;
CREATE TRIGGER work_orders_log_stage_change_update
  AFTER UPDATE ON public.work_orders
  FOR EACH ROW
  WHEN (NEW.stage IS DISTINCT FROM OLD.stage)
  EXECUTE PROCEDURE public.work_orders_log_stage_change();

-- 5. RLS：僅開放已登入者查詢歷程，寫入一律透過上面的 SECURITY DEFINER trigger
ALTER TABLE public.work_order_stage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_order_stage_history_select_authenticated ON public.work_order_stage_history;
CREATE POLICY work_order_stage_history_select_authenticated
  ON public.work_order_stage_history FOR SELECT TO authenticated
  USING (true);

-- 6. 既有工單補一筆歷史紀錄（以目前 stage 當初始值，changed_at 用 updated_at/created_at）
INSERT INTO public.work_order_stage_history (work_order_id, old_stage, new_stage, changed_at)
SELECT wo.id, NULL, wo.stage, COALESCE(wo.updated_at, wo.created_at, now())
FROM public.work_orders wo
WHERE NOT EXISTS (
  SELECT 1 FROM public.work_order_stage_history h WHERE h.work_order_id = wo.id
);
