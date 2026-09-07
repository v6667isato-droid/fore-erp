-- 退回原因：主控端退回請假／加班／補打卡時可填寫原因，並顯示於員工儀表板（同 20260907110000 的撤銷原因）
-- 1) leave_requests / overtime_requests / makeup_punch_requests 各加 reject_reason 欄位
-- 2) reject_overtime_request / reject_makeup_punch_request 改簽章加 p_reason（DEFAULT NULL，
--    telegram bot 以 service_role 只帶 p_request_id 呼叫仍相容；本體沿用 20260807010000 / 20260820000000）
--    （請假退回為前端直接 UPDATE，不經 RPC）
ALTER TABLE public.leave_requests
ADD COLUMN IF NOT EXISTS reject_reason text;

ALTER TABLE public.overtime_requests
ADD COLUMN IF NOT EXISTS reject_reason text;

ALTER TABLE public.makeup_punch_requests
ADD COLUMN IF NOT EXISTS reject_reason text;

COMMENT ON COLUMN public.leave_requests.reject_reason IS '管理端退回原因（顯示於員工儀表板）';

COMMENT ON COLUMN public.overtime_requests.reject_reason IS '管理端退回原因（顯示於員工儀表板）';

COMMENT ON COLUMN public.makeup_punch_requests.reject_reason IS '管理端退回原因（顯示於員工儀表板）';

-- 換簽章需先移除舊函式，避免 (uuid) 與 (uuid, text DEFAULT NULL) 雙載造成呼叫模稜兩可
DROP FUNCTION IF EXISTS public.reject_overtime_request (uuid);

-- 退回：管理員或 service_role（telegram bot），可附退回原因
CREATE OR REPLACE FUNCTION public.reject_overtime_request (p_request_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE
        up.user_id = auth.uid()
        AND lower(trim(COALESCE(up.role::text, ''))) = 'admin'
    )
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT status INTO v_status FROM public.overtime_requests WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  UPDATE public.overtime_requests
  SET
    status = 'rejected',
    reject_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
    approved_by = auth.uid(),
    approved_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;

$$;

REVOKE ALL ON FUNCTION public.reject_overtime_request (uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reject_overtime_request (uuid, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.reject_makeup_punch_request (uuid);

-- 退回：管理員或 service_role（telegram bot），可附退回原因
CREATE OR REPLACE FUNCTION public.reject_makeup_punch_request (p_request_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE
        up.user_id = auth.uid()
        AND lower(trim(COALESCE(up.role::text, ''))) = 'admin'
    )
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT status INTO v_status FROM public.makeup_punch_requests WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  UPDATE public.makeup_punch_requests
  SET
    status = 'rejected',
    reject_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
    approved_by = auth.uid(),
    approved_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;

$$;

REVOKE ALL ON FUNCTION public.reject_makeup_punch_request (uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reject_makeup_punch_request (uuid, text) TO authenticated, service_role;
