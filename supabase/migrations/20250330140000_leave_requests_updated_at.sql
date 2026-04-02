-- 假單異動時間：核准／退回或內容修改時更新，供員工端與薪資出勤備註顯示「已更新」

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.leave_requests
SET updated_at = COALESCE(created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE public.leave_requests
  ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.leave_requests
  ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.leave_requests_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leave_requests_set_updated_at ON public.leave_requests;
CREATE TRIGGER leave_requests_set_updated_at
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.leave_requests_set_updated_at();

COMMENT ON COLUMN public.leave_requests.updated_at IS '最後更新時間（含管理員核准／退回與內容修改）';
