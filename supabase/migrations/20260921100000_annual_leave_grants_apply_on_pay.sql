-- 特休授予改為「核准 → 薪資發放時才入餘額」：
-- 薪資結算頁核准只寫授予紀錄（applied_at 為 null），發放該員工薪資時才加到 employees.annual_leave_remaining
ALTER TABLE public.annual_leave_grants
  ADD COLUMN IF NOT EXISTS pay_period text,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

COMMENT ON COLUMN public.annual_leave_grants.pay_period IS '核准／入帳的結算月份（YYYY-MM）；發放時改寫為實際入帳月份';
COMMENT ON COLUMN public.annual_leave_grants.applied_at IS '已加入特休餘額的時間；null＝已核准、待下次發放薪資時入帳';

-- 既有紀錄（回填與舊流程核准者）當時已直接入餘額，視為已入帳
UPDATE public.annual_leave_grants
SET applied_at = granted_at
WHERE applied_at IS NULL;

CREATE POLICY "annual_leave_grants_update_authenticated"
  ON public.annual_leave_grants FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
