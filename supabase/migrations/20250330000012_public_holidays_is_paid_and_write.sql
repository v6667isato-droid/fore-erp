-- 放假是否支薪；並開放 authenticated 新增／刪除（後台手動維護颱風假等）
ALTER TABLE public.public_holidays
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.public_holidays.is_paid IS '放假是否支薪；false 時戰情室標示無薪特殊假（薪資結算用）';

DROP POLICY IF EXISTS "public_holidays_authenticated_insert" ON public.public_holidays;
DROP POLICY IF EXISTS "public_holidays_authenticated_delete" ON public.public_holidays;

CREATE POLICY "public_holidays_authenticated_insert" ON public.public_holidays
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "public_holidays_authenticated_delete" ON public.public_holidays
  FOR DELETE TO authenticated USING (true);

GRANT INSERT, DELETE ON public.public_holidays TO authenticated;
