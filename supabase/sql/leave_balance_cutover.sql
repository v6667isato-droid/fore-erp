-- 特休／補休「核准即扣」切換（套用 20261104110000_leave_balance_ledger.sql 之後執行一次；可重複執行）
--
-- 舊流程：特休／補休在「假單建立月」的薪資發放時才自餘額扣除。
-- 新流程：核准當下即扣，並記錄 balance_deducted_hours（撤銷／回補時精確退回）。
--
-- 對每張已核准、尚未標記的特休／補休假單：
--   1. 建立月份 ≤ 該員工最新已發放薪資月份 → 舊流程已扣過（或在系統發薪前就已扣入餘額），只標記，不動餘額
--   2. 建立月份 > 最新已發放月份（或從未發薪）→ 舊流程還沒扣：立即扣除，寫入異動紀錄（reason = cutover）

-- ── 預覽（不修改資料） ────────────────────────────────────────────
WITH latest AS (
  SELECT employee_id, max(left(period_key, 7)) AS latest_ym
  FROM public.payslips
  WHERE lower(trim(COALESCE(status, ''))) IN ('paid', '已發放', '發放')
  GROUP BY employee_id
)
SELECT
  CASE
    WHEN la.latest_ym IS NOT NULL
      AND to_char(l.created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') <= la.latest_ym THEN 'mark_settled'
    ELSE 'deduct_now'
  END AS action,
  e.name,
  l.leave_type,
  l.start_date,
  l.end_date,
  COALESCE(NULLIF(l.hours_count, 0), l.total_days * 8) AS hours
FROM public.leave_requests l
JOIN public.employees e ON e.id = l.employee_id
LEFT JOIN latest la ON la.employee_id = l.employee_id
WHERE
  lower(trim(COALESCE(l.status, ''))) IN ('approved', '已核准', '核准')
  AND public.leave_balance_kind(l.leave_type) IS NOT NULL
  AND l.balance_deducted_hours IS NULL
ORDER BY action, e.name, l.start_date;

-- ── 執行 ─────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
  v_latest text;
  v_created_ym text;
  v_hours numeric;
  v_paid_at timestamptz;
BEGIN
  FOR r IN
    SELECT l.*, public.leave_balance_kind(l.leave_type) AS kind
    FROM public.leave_requests l
    WHERE
      lower(trim(COALESCE(l.status, ''))) IN ('approved', '已核准', '核准')
      AND public.leave_balance_kind(l.leave_type) IS NOT NULL
      AND l.balance_deducted_hours IS NULL
    ORDER BY l.created_at
    FOR UPDATE
  LOOP
    v_hours := COALESCE(NULLIF(r.hours_count, 0), r.total_days * 8.0, 0);
    v_created_ym := to_char(r.created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM');

    SELECT max(left(p.period_key, 7)) INTO v_latest
    FROM public.payslips p
    WHERE p.employee_id = r.employee_id
      AND lower(trim(COALESCE(p.status, ''))) IN ('paid', '已發放', '發放');

    IF v_latest IS NOT NULL AND v_created_ym <= v_latest THEN
      SELECT min(p.created_at) INTO v_paid_at
      FROM public.payslips p
      WHERE p.employee_id = r.employee_id
        AND left(p.period_key, 7) = v_created_ym
        AND lower(trim(COALESCE(p.status, ''))) IN ('paid', '已發放', '發放');

      UPDATE public.leave_requests
      SET balance_deducted_hours = v_hours,
          balance_deducted_at = COALESCE(v_paid_at, r.created_at),
          approved_at = COALESCE(approved_at, r.updated_at)
      WHERE id = r.id;
    ELSE
      PERFORM 1 FROM public.employees WHERE id = r.employee_id FOR UPDATE;
      PERFORM public.apply_leave_balance_change(
        r.employee_id, r.kind, -v_hours, 'cutover', r.id, NULL, '系統切換為核准即扣'
      );
      UPDATE public.leave_requests
      SET balance_deducted_hours = v_hours,
          balance_deducted_at = now(),
          approved_at = COALESCE(approved_at, r.updated_at)
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;
