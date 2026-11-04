-- 特休／補休改為「核准即扣」＋異動紀錄＋颱風假等臨時假日回補＋年資特休核准可調天數
--
-- 1. leave_balance_ledger：特休／補休餘額每一次異動一筆（核准扣除、撤銷退回、假日回補、年資新增、人工調整、系統切換）
--    薪資結算依此列出當月異動備註；payslip_period 標記已列入哪一個月的薪資單
-- 2. leave_holiday_refunds：假單送出後才新增的放假日（颱風假等），逐日產生回補單，審核通過才回補
-- 3. leave_requests 記錄核准時實際扣除的時數，撤銷／回補時精確退回
-- 4. annual_leave_grants 記錄法定天數與實際核給天數（可依入職約定調整）
-- 5. payslips.leave_settlement：每張薪資單結算了哪些假單、哪個月份、幾小時（跨月補扣／補發對帳用）
-- 寫入一律經 SECURITY DEFINER RPC（僅 admin），表本身只開放讀取。

-- ── 權限 ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_leave_admin () RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = public AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE
        up.user_id = auth.uid()
        AND lower(trim(COALESCE(up.role::text, ''))) = 'admin'
    )
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
$$;

REVOKE ALL ON FUNCTION public.is_leave_admin () FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_leave_admin () TO authenticated, service_role;

-- 假別 → 餘額種類（特休／補休），其他假別回 NULL
CREATE OR REPLACE FUNCTION public.leave_balance_kind (p_leave_type text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN trim(COALESCE(p_leave_type, '')) = '特休' THEN 'annual'
    WHEN trim(COALESCE(p_leave_type, '')) LIKE '補休%' THEN 'comp'
    ELSE NULL
  END;
$$;

-- ── 資料表 ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_balance_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('annual', 'comp')),
  -- 一律以小時記錄（特休 1 天＝8 小時）；正數＝增加餘額，負數＝扣除
  delta_hours numeric NOT NULL,
  -- 異動後餘額（小時）
  balance_after_hours numeric,
  reason text NOT NULL CHECK (
    reason IN (
      'leave_approved',
      'leave_revoked',
      'holiday_refund',
      'annual_grant',
      'manual_adjust',
      'cutover'
    )
  ),
  leave_request_id uuid REFERENCES public.leave_requests (id) ON DELETE SET NULL,
  -- annual_leave_grants.id／leave_holiday_refunds.id 等
  ref_id uuid,
  note text,
  -- 已列入哪個月份的薪資單備註（YYYY-MM）；NULL＝尚未列入
  payslip_period text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leave_balance_ledger_employee_created_idx ON public.leave_balance_ledger (employee_id, created_at);

COMMENT ON TABLE public.leave_balance_ledger IS '特休／補休餘額異動紀錄；薪資結算依此產生當月異動備註';

ALTER TABLE public.leave_balance_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_balance_ledger_select_authenticated ON public.leave_balance_ledger;

CREATE POLICY leave_balance_ledger_select_authenticated ON public.leave_balance_ledger FOR
SELECT
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.leave_holiday_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id uuid NOT NULL REFERENCES public.leave_requests (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  holiday_name text,
  -- 該假單在放假日當天的請假時數
  hours numeric NOT NULL CHECK (hours > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leave_request_id, holiday_date)
);

COMMENT ON TABLE public.leave_holiday_refunds IS '假單送出後才新增的放假日（颱風假等）回補單；核准後扣回假單時數並退回特休／補休';

ALTER TABLE public.leave_holiday_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_holiday_refunds_select_authenticated ON public.leave_holiday_refunds;

CREATE POLICY leave_holiday_refunds_select_authenticated ON public.leave_holiday_refunds FOR
SELECT
  TO authenticated USING (true);

ALTER TABLE public.leave_requests
ADD COLUMN IF NOT EXISTS balance_deducted_hours numeric,
ADD COLUMN IF NOT EXISTS balance_deducted_at timestamptz,
ADD COLUMN IF NOT EXISTS approved_at timestamptz,
ADD COLUMN IF NOT EXISTS approved_by uuid;

COMMENT ON COLUMN public.leave_requests.balance_deducted_hours IS '特休／補休：目前仍自餘額扣除中的時數（核准時扣、撤銷／回補時減少）；NULL＝未扣或非額度型假別';

ALTER TABLE public.annual_leave_grants
ADD COLUMN IF NOT EXISTS statutory_days numeric,
ADD COLUMN IF NOT EXISTS approved_by uuid;

COMMENT ON COLUMN public.annual_leave_grants.statutory_days IS '勞基法法定天數；days 為實際核給（可依入職約定調整）';

ALTER TABLE public.payslips
ADD COLUMN IF NOT EXISTS leave_settlement jsonb;

COMMENT ON COLUMN public.payslips.leave_settlement IS '本張薪資單結算的扣薪假單明細 [{leave_request_id, period, leave_type, hours, ratio, amount}]；period 早於本月者為前期補扣（正）／補發（負）';

-- ── 內部：寫入異動並更新餘額 ─────────────────────────────────────
-- 呼叫端需已檢查權限；回傳異動後餘額（小時）
CREATE OR REPLACE FUNCTION public.apply_leave_balance_change (
  p_employee_id uuid,
  p_kind text,
  p_delta_hours numeric,
  p_reason text,
  p_leave_request_id uuid,
  p_ref_id uuid,
  p_note text
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_after numeric;
BEGIN
  IF p_kind = 'annual' THEN
    UPDATE public.employees
    SET annual_leave_remaining = COALESCE(annual_leave_remaining, 0) + p_delta_hours / 8.0
    WHERE id = p_employee_id
    RETURNING annual_leave_remaining * 8.0 INTO v_after;
  ELSE
    UPDATE public.employees
    SET comp_leave_remaining = COALESCE(comp_leave_remaining, 0) + p_delta_hours
    WHERE id = p_employee_id
    RETURNING comp_leave_remaining INTO v_after;
  END IF;

  INSERT INTO public.leave_balance_ledger (
    employee_id, kind, delta_hours, balance_after_hours, reason, leave_request_id, ref_id, note
  )
  VALUES (
    p_employee_id, p_kind, p_delta_hours, v_after, p_reason, p_leave_request_id, p_ref_id,
    NULLIF(trim(COALESCE(p_note, '')), '')
  );

  RETURN v_after;
END;
$$;

-- 內部函式（無權限檢查）：Supabase 預設會授權 anon／authenticated，須明確收回
REVOKE ALL ON FUNCTION public.apply_leave_balance_change (uuid, text, numeric, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 核准假單：特休／補休立即扣除 ─────────────────────────────────
-- p_hours：核准時數（假單送出後才新增的放假日已排除）；NULL＝沿用 hours_count
-- p_note：系統附註（例如「核准時已排除 10/23 颱風假 8 小時」），附加在 reason 後
CREATE OR REPLACE FUNCTION public.approve_leave_request (
  p_leave_id uuid,
  p_hours numeric DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_req public.leave_requests%ROWTYPE;
  v_kind text;
  v_hours numeric;
  v_balance numeric;
  v_after numeric;
BEGIN
  IF NOT public.is_leave_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_leave_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF lower(trim(COALESCE(v_req.status, ''))) NOT IN ('pending', '待審核', '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  v_hours := COALESCE(p_hours, NULLIF(v_req.hours_count, 0), v_req.total_days * 8.0);
  IF v_hours IS NULL OR v_hours <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_hours');
  END IF;
  IF p_hours IS NOT NULL AND v_req.hours_count IS NOT NULL AND p_hours > v_req.hours_count + 0.001 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_hours');
  END IF;

  v_kind := public.leave_balance_kind(v_req.leave_type);
  IF v_kind IS NOT NULL THEN
    SELECT CASE WHEN v_kind = 'annual' THEN e.annual_leave_remaining * 8.0 ELSE e.comp_leave_remaining END
    INTO v_balance
    FROM public.employees e
    WHERE e.id = v_req.employee_id
    FOR UPDATE;
    IF v_balance IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_balance');
    END IF;
    IF v_hours > v_balance + 0.01 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'balance_hours', v_balance, 'hours', v_hours);
    END IF;
    v_after := public.apply_leave_balance_change(
      v_req.employee_id, v_kind, -v_hours, 'leave_approved', v_req.id, NULL, NULL
    );
  END IF;

  UPDATE public.leave_requests
  SET
    status = 'approved',
    approved_at = now(),
    approved_by = auth.uid(),
    hours_count = v_hours,
    total_days = CASE
      WHEN v_req.hours_count IS DISTINCT FROM v_hours THEN v_hours / 8.0
      ELSE total_days
    END,
    reason = CASE
      WHEN NULLIF(trim(COALESCE(p_note, '')), '') IS NULL THEN reason
      ELSE concat_ws(E'\n', NULLIF(reason, ''), trim(p_note))
    END,
    balance_deducted_hours = CASE WHEN v_kind IS NOT NULL THEN v_hours ELSE balance_deducted_hours END,
    balance_deducted_at = CASE WHEN v_kind IS NOT NULL THEN now() ELSE balance_deducted_at END
  WHERE id = p_leave_id;

  RETURN jsonb_build_object('ok', true, 'kind', v_kind, 'hours', v_hours, 'balance_after_hours', v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_leave_request (uuid, numeric, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.approve_leave_request (uuid, numeric, text) TO authenticated, service_role;

-- ── 撤銷已核准假單：特休／補休退回目前仍扣除中的時數 ─────────────
CREATE OR REPLACE FUNCTION public.revoke_leave_request (p_leave_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_req public.leave_requests%ROWTYPE;
  v_kind text;
  v_refund numeric;
BEGIN
  IF NOT public.is_leave_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_leave_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF lower(trim(COALESCE(v_req.status, ''))) NOT IN ('approved', '已核准', '核准') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  v_kind := public.leave_balance_kind(v_req.leave_type);
  v_refund := COALESCE(v_req.balance_deducted_hours, 0);
  IF v_kind IS NOT NULL AND v_refund > 0 THEN
    PERFORM public.apply_leave_balance_change(
      v_req.employee_id, v_kind, v_refund, 'leave_revoked', v_req.id, NULL, NULLIF(trim(COALESCE(p_reason, '')), '')
    );
  END IF;

  UPDATE public.leave_requests
  SET
    status = 'revoked',
    revoke_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
    balance_deducted_hours = CASE WHEN v_kind IS NOT NULL THEN 0 ELSE balance_deducted_hours END
  WHERE id = p_leave_id;

  UPDATE public.leave_holiday_refunds
  SET status = 'rejected', reject_reason = '假單已撤銷', decided_by = auth.uid(), decided_at = now()
  WHERE leave_request_id = p_leave_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'kind', v_kind, 'refund_hours', CASE WHEN v_kind IS NOT NULL THEN v_refund ELSE 0 END);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_leave_request (uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.revoke_leave_request (uuid, text) TO authenticated, service_role;

-- ── 年資特休：核准即入帳，天數可依入職約定調整 ──────────────────
CREATE OR REPLACE FUNCTION public.approve_annual_leave_grant (
  p_employee_id uuid,
  p_milestone_years numeric,
  p_days numeric,
  p_statutory_days numeric,
  p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_grant_id uuid;
  v_note text := NULLIF(trim(COALESCE(p_note, '')), '');
  v_after numeric;
BEGIN
  IF NOT public.is_leave_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_days IS NULL OR p_days <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_days');
  END IF;
  IF abs(p_days - COALESCE(p_statutory_days, p_days)) > 0.001 AND v_note IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'note_required');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee_id AND e.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'employee_not_found');
  END IF;

  INSERT INTO public.annual_leave_grants (
    employee_id, milestone_years, days, statutory_days, note, pay_period, applied_at, approved_by
  )
  VALUES (
    p_employee_id, p_milestone_years, p_days, p_statutory_days, v_note,
    to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYY-MM'), now(), auth.uid()
  )
  ON CONFLICT (employee_id, milestone_years) DO NOTHING
  RETURNING id INTO v_grant_id;

  IF v_grant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_granted');
  END IF;

  v_after := public.apply_leave_balance_change(
    p_employee_id, 'annual', p_days * 8.0, 'annual_grant', NULL, v_grant_id, v_note
  );

  RETURN jsonb_build_object('ok', true, 'grant_id', v_grant_id, 'balance_after_hours', v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_annual_leave_grant (uuid, numeric, numeric, numeric, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.approve_annual_leave_grant (uuid, numeric, numeric, numeric, text) TO authenticated, service_role;

-- ── 人工調整特休／補休（原因必填） ───────────────────────────────
CREATE OR REPLACE FUNCTION public.adjust_leave_balance (
  p_employee_id uuid,
  p_kind text,
  p_delta_hours numeric,
  p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_after numeric;
BEGIN
  IF NOT public.is_leave_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_kind NOT IN ('annual', 'comp') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_kind');
  END IF;
  IF p_delta_hours IS NULL OR p_delta_hours = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_hours');
  END IF;
  IF NULLIF(trim(COALESCE(p_note, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'note_required');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'employee_not_found');
  END IF;

  PERFORM 1 FROM public.employees WHERE id = p_employee_id FOR UPDATE;
  v_after := public.apply_leave_balance_change(
    p_employee_id, p_kind, p_delta_hours, 'manual_adjust', NULL, NULL, p_note
  );
  RETURN jsonb_build_object('ok', true, 'balance_after_hours', v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_leave_balance (uuid, text, numeric, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.adjust_leave_balance (uuid, text, numeric, text) TO authenticated, service_role;

-- ── 假日回補單：建立（重複呼叫不會重複建立） ─────────────────────
-- p_items：[{leave_request_id, holiday_date, holiday_name, hours}]，僅已核准假單有效
CREATE OR REPLACE FUNCTION public.create_holiday_refunds (p_items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_leave_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  WITH items AS (
    SELECT DISTINCT ON ((x ->> 'leave_request_id'), (x ->> 'holiday_date'))
      (x ->> 'leave_request_id')::uuid AS leave_request_id,
      (x ->> 'holiday_date')::date AS holiday_date,
      NULLIF(x ->> 'holiday_name', '') AS holiday_name,
      (x ->> 'hours')::numeric AS hours
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) WITH ORDINALITY AS t (x, ord)
    ORDER BY (x ->> 'leave_request_id'), (x ->> 'holiday_date'), ord
  ),
  ins AS (
    INSERT INTO public.leave_holiday_refunds (leave_request_id, employee_id, holiday_date, holiday_name, hours)
    SELECT i.leave_request_id, l.employee_id, i.holiday_date, i.holiday_name, i.hours
    FROM items i
    JOIN public.leave_requests l ON l.id = i.leave_request_id
    WHERE
      i.hours > 0
      AND lower(trim(COALESCE(l.status, ''))) IN ('approved', '已核准', '核准')
      AND i.holiday_date BETWEEN l.start_date AND l.end_date
    ON CONFLICT (leave_request_id, holiday_date) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN jsonb_build_object('ok', true, 'created', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.create_holiday_refunds (jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_holiday_refunds (jsonb) TO authenticated, service_role;

-- ── 假日回補單：核准／退回 ───────────────────────────────────────
-- 核准：假單時數扣掉當日時數（扣薪假別的薪資由結算對帳處理），特休／補休退回餘額
CREATE OR REPLACE FUNCTION public.decide_holiday_refund (
  p_refund_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_ref public.leave_holiday_refunds%ROWTYPE;
  v_req public.leave_requests%ROWTYPE;
  v_kind text;
  v_hours numeric;
  v_refund numeric := 0;
  v_label text;
BEGIN
  IF NOT public.is_leave_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_ref FROM public.leave_holiday_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_ref.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF NOT p_approve THEN
    UPDATE public.leave_holiday_refunds
    SET status = 'rejected', reject_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
        decided_by = auth.uid(), decided_at = now()
    WHERE id = p_refund_id;
    RETURN jsonb_build_object('ok', true, 'approved', false);
  END IF;

  SELECT * INTO v_req FROM public.leave_requests WHERE id = v_ref.leave_request_id FOR UPDATE;
  IF NOT FOUND OR lower(trim(COALESCE(v_req.status, ''))) NOT IN ('approved', '已核准', '核准') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'leave_not_approved');
  END IF;

  v_hours := least(v_ref.hours, COALESCE(v_req.hours_count, v_req.total_days * 8.0, 0));
  IF v_hours <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_hours');
  END IF;

  v_label := to_char(v_ref.holiday_date, 'FMMM/FMDD') || ' ' || COALESCE(v_ref.holiday_name, '放假日');
  v_kind := public.leave_balance_kind(v_req.leave_type);

  IF v_kind IS NOT NULL AND COALESCE(v_req.balance_deducted_hours, 0) > 0 THEN
    v_refund := least(v_hours, v_req.balance_deducted_hours);
    PERFORM 1 FROM public.employees WHERE id = v_req.employee_id FOR UPDATE;
    PERFORM public.apply_leave_balance_change(
      v_req.employee_id, v_kind, v_refund, 'holiday_refund', v_req.id, v_ref.id, v_label
    );
  END IF;

  UPDATE public.leave_requests
  SET
    hours_count = greatest(0, COALESCE(hours_count, total_days * 8.0, 0) - v_hours),
    total_days = greatest(0, COALESCE(hours_count, total_days * 8.0, 0) - v_hours) / 8.0,
    balance_deducted_hours = CASE
      WHEN v_kind IS NOT NULL AND balance_deducted_hours IS NOT NULL THEN balance_deducted_hours - v_refund
      ELSE balance_deducted_hours
    END,
    reason = concat_ws(
      E'\n',
      NULLIF(reason, ''),
      '【系統】' || v_label || ' 回補 ' || rtrim(to_char(v_hours, 'FM999990.99'), '.') || ' 小時'
    )
  WHERE id = v_req.id;

  UPDATE public.leave_holiday_refunds
  SET status = 'approved', hours = v_hours, decided_by = auth.uid(), decided_at = now()
  WHERE id = p_refund_id;

  RETURN jsonb_build_object('ok', true, 'approved', true, 'kind', v_kind, 'hours', v_hours, 'refund_hours', v_refund);
END;
$$;

REVOKE ALL ON FUNCTION public.decide_holiday_refund (uuid, boolean, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.decide_holiday_refund (uuid, boolean, text) TO authenticated, service_role;

-- ── 薪資單：標記／取消標記異動已列入備註 ─────────────────────────
CREATE OR REPLACE FUNCTION public.mark_leave_ledger_payslip (
  p_employee_id uuid,
  p_period text,
  p_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_leave_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  UPDATE public.leave_balance_ledger
  SET payslip_period = p_period
  WHERE employee_id = p_employee_id AND id = ANY (COALESCE(p_ids, '{}')) AND payslip_period IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'marked', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_leave_ledger_payslip (uuid, text, uuid[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.mark_leave_ledger_payslip (uuid, text, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unmark_leave_ledger_payslip (p_employee_id uuid, p_period text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_leave_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  UPDATE public.leave_balance_ledger
  SET payslip_period = NULL
  WHERE employee_id = p_employee_id AND payslip_period = p_period;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'unmarked', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.unmark_leave_ledger_payslip (uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.unmark_leave_ledger_payslip (uuid, text) TO authenticated, service_role;
