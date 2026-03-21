-- 國定／補班為全公司參考資料；允許 anon 讀取，與 authenticated 政策並存（OR）
-- 未登入或 JWT 角色異常時，戰情月曆仍能對齊 public_holidays
GRANT SELECT ON public.public_holidays TO anon;

DROP POLICY IF EXISTS "public_holidays_anon_select" ON public.public_holidays;
CREATE POLICY "public_holidays_anon_select"
  ON public.public_holidays
  FOR SELECT
  TO anon
  USING (true);
