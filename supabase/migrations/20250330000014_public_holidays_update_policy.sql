-- 允許已登入使用者更新 public_holidays（與手動假日表單「覆寫」同日期設定一致）
DROP POLICY IF EXISTS "public_holidays_authenticated_update" ON public.public_holidays;

CREATE POLICY "public_holidays_authenticated_update" ON public.public_holidays
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT UPDATE ON public.public_holidays TO authenticated;
