-- 調薪紀錄（D 階段）：每次調薪一筆，記錄生效月份、新舊月薪、原因與投保資料變更。
-- - 薪資結算依「結算月份」取當月生效的月薪與勞健保自付額（可提前登記，生效月份前的薪資不受影響）
-- - 生效月份到了（台北時間）才寫入 employees 目前資料：建立時已到就立即寫入，其餘由每日排程寫入
-- - 生效月份不可選已發放的月份，且須晚於最近一次調薪（歷史保持線性；要改請先取消最近一筆）
-- 寫入一律經 SECURITY DEFINER RPC（僅 admin）；資料只開放 admin 讀取（薪資敏感）。

CREATE TABLE IF NOT EXISTS public.salary_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  effective_month text NOT NULL CHECK (effective_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  old_wage numeric NOT NULL,
  new_wage numeric NOT NULL CHECK (new_wage > 0),
  -- 投保資料：new_* 為 NULL＝本次不變；old_* 記錄調整前的值
  old_labor_insurance_bracket numeric,
  new_labor_insurance_bracket numeric,
  old_labor_employee_burden numeric,
  new_labor_employee_burden numeric,
  old_health_employee_burden numeric,
  new_health_employee_burden numeric,
  reason text NOT NULL,
  -- 已寫入 employees 目前資料的時間；NULL＝生效月份還沒到
  applied_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, effective_month)
);

COMMENT ON TABLE public.salary_adjustments IS '調薪紀錄；薪資結算依生效月份取用月薪與勞健保自付額，生效月份的薪資單備註列出調薪';

ALTER TABLE public.salary_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salary_adjustments_select_admin ON public.salary_adjustments;

-- is_leave_admin()：admin（老闆）判斷，與假勤 RPC 共用
CREATE POLICY salary_adjustments_select_admin ON public.salary_adjustments FOR
SELECT
  TO authenticated USING (public.is_leave_admin ());

-- ── 生效月份已到的調薪寫入 employees（每日排程與建立時呼叫） ──────
CREATE OR REPLACE FUNCTION public.apply_due_salary_adjustments () RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  r public.salary_adjustments%ROWTYPE;
  v_count integer := 0;
  v_now_month text := to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYY-MM');
BEGIN
  FOR r IN
    SELECT *
    FROM public.salary_adjustments
    WHERE applied_at IS NULL AND effective_month <= v_now_month
    ORDER BY employee_id, effective_month
    FOR UPDATE
  LOOP
    UPDATE public.employees
    SET
      monthly_wage = r.new_wage,
      labor_insurance_bracket = COALESCE(r.new_labor_insurance_bracket, labor_insurance_bracket),
      labor_employee_burden = COALESCE(r.new_labor_employee_burden, labor_employee_burden),
      health_employee_burden = COALESCE(r.new_health_employee_burden, health_employee_burden)
    WHERE id = r.employee_id;

    UPDATE public.salary_adjustments SET applied_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_due_salary_adjustments () FROM PUBLIC, anon, authenticated;

-- ── 建立調薪 ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_salary_adjustment (
  p_employee_id uuid,
  p_effective_month text,
  p_new_wage numeric,
  p_reason text,
  p_labor_insurance_bracket numeric DEFAULT NULL,
  p_labor_employee_burden numeric DEFAULT NULL,
  p_health_employee_burden numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_emp public.employees%ROWTYPE;
  v_latest_paid text;
  v_last_adj text;
  v_old_wage numeric;
  v_old_bracket numeric;
  v_old_labor numeric;
  v_old_health numeric;
  v_id uuid;
  v_applied integer := 0;
BEGIN
  IF NOT public.is_leave_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_effective_month IS NULL OR p_effective_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_month');
  END IF;
  IF p_new_wage IS NULL OR p_new_wage <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_wage');
  END IF;
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
  END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'employee_not_found');
  END IF;

  SELECT max(left(period_key, 7)) INTO v_latest_paid
  FROM public.payslips
  WHERE employee_id = p_employee_id AND lower(trim(COALESCE(status, ''))) IN ('paid', '已發放', '發放');
  IF v_latest_paid IS NOT NULL AND p_effective_month <= v_latest_paid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'month_paid', 'latest_paid', v_latest_paid);
  END IF;

  SELECT max(effective_month) INTO v_last_adj FROM public.salary_adjustments WHERE employee_id = p_employee_id;
  IF v_last_adj IS NOT NULL AND p_effective_month <= v_last_adj THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_after_latest', 'latest_month', v_last_adj);
  END IF;

  -- 調整前的值：最近一次調薪的新值（可能尚未生效），沒有則用目前資料
  v_old_wage := COALESCE(
    (SELECT new_wage FROM public.salary_adjustments WHERE employee_id = p_employee_id ORDER BY effective_month DESC LIMIT 1),
    v_emp.monthly_wage, 0
  );
  v_old_bracket := COALESCE(
    (SELECT new_labor_insurance_bracket FROM public.salary_adjustments
     WHERE employee_id = p_employee_id AND new_labor_insurance_bracket IS NOT NULL ORDER BY effective_month DESC LIMIT 1),
    v_emp.labor_insurance_bracket
  );
  v_old_labor := COALESCE(
    (SELECT new_labor_employee_burden FROM public.salary_adjustments
     WHERE employee_id = p_employee_id AND new_labor_employee_burden IS NOT NULL ORDER BY effective_month DESC LIMIT 1),
    v_emp.labor_employee_burden
  );
  v_old_health := COALESCE(
    (SELECT new_health_employee_burden FROM public.salary_adjustments
     WHERE employee_id = p_employee_id AND new_health_employee_burden IS NOT NULL ORDER BY effective_month DESC LIMIT 1),
    v_emp.health_employee_burden
  );

  INSERT INTO public.salary_adjustments (
    employee_id, effective_month, old_wage, new_wage,
    old_labor_insurance_bracket, new_labor_insurance_bracket,
    old_labor_employee_burden, new_labor_employee_burden,
    old_health_employee_burden, new_health_employee_burden,
    reason
  )
  VALUES (
    p_employee_id, p_effective_month, v_old_wage, p_new_wage,
    v_old_bracket, p_labor_insurance_bracket,
    v_old_labor, p_labor_employee_burden,
    v_old_health, p_health_employee_burden,
    trim(p_reason)
  )
  RETURNING id INTO v_id;

  -- 生效月份已到：立即寫入目前資料
  v_applied := public.apply_due_salary_adjustments();

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'old_wage', v_old_wage,
    'applied', EXISTS (SELECT 1 FROM public.salary_adjustments WHERE id = v_id AND applied_at IS NOT NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_salary_adjustment (uuid, text, numeric, text, numeric, numeric, numeric) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_salary_adjustment (uuid, text, numeric, text, numeric, numeric, numeric) TO authenticated, service_role;

-- ── 取消調薪：只能取消最近一筆、且生效月份尚未發放 ───────────────
CREATE OR REPLACE FUNCTION public.cancel_salary_adjustment (p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  r public.salary_adjustments%ROWTYPE;
  v_latest_paid text;
BEGIN
  IF NOT public.is_leave_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO r FROM public.salary_adjustments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.salary_adjustments
    WHERE employee_id = r.employee_id AND effective_month > r.effective_month
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_latest');
  END IF;

  SELECT max(left(period_key, 7)) INTO v_latest_paid
  FROM public.payslips
  WHERE employee_id = r.employee_id AND lower(trim(COALESCE(status, ''))) IN ('paid', '已發放', '發放');
  IF v_latest_paid IS NOT NULL AND r.effective_month <= v_latest_paid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'month_paid', 'latest_paid', v_latest_paid);
  END IF;

  -- 已寫入目前資料者還原為調整前的值
  IF r.applied_at IS NOT NULL THEN
    UPDATE public.employees
    SET
      monthly_wage = r.old_wage,
      labor_insurance_bracket = CASE WHEN r.new_labor_insurance_bracket IS NOT NULL THEN r.old_labor_insurance_bracket ELSE labor_insurance_bracket END,
      labor_employee_burden = CASE WHEN r.new_labor_employee_burden IS NOT NULL THEN r.old_labor_employee_burden ELSE labor_employee_burden END,
      health_employee_burden = CASE WHEN r.new_health_employee_burden IS NOT NULL THEN r.old_health_employee_burden ELSE health_employee_burden END
    WHERE id = r.employee_id;
  END IF;

  DELETE FROM public.salary_adjustments WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_salary_adjustment (uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.cancel_salary_adjustment (uuid) TO authenticated, service_role;

-- ── 每日 00:05（台北）把生效月份已到的調薪寫入目前資料 ───────────
SELECT
  cron.schedule (
    'apply-salary-adjustments-0005',
    '5 16 * * *',
    $$select public.apply_due_salary_adjustments()$$
  );
