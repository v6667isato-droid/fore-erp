-- 國定假日／補班日（出勤戰情判定用）；若遠端已手動建表可略過 CREATE
CREATE TABLE IF NOT EXISTS public.public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL,
  name text NOT NULL,
  is_workday boolean NOT NULL DEFAULT false,
  CONSTRAINT public_holidays_date_key UNIQUE (holiday_date)
);

CREATE INDEX IF NOT EXISTS public_holidays_holiday_date_idx ON public.public_holidays (holiday_date);

COMMENT ON TABLE public.public_holidays IS '國定假日與補班：is_workday=false 放假；true=補班（視同平日出勤規則）';

COMMENT ON COLUMN public.public_holidays.is_workday IS 'false：放假（豁免未出勤／遲到等）；true：補班日';

ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_holidays_authenticated_select" ON public.public_holidays;

CREATE POLICY "public_holidays_authenticated_select" ON public.public_holidays FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.public_holidays TO authenticated;
