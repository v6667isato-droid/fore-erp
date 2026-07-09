-- fore-furniture.com 官網 /contact 表單送出後寫入此表，由 ERP 內部人員追蹤後續處理
CREATE TABLE public.inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact text NOT NULL,
  type text,
  message text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;

-- 官網以 anon 直接 insert，不需登入
CREATE POLICY inquiries_anon_insert ON public.inquiries FOR INSERT TO anon WITH CHECK (true);

-- ERP 內部人員（authenticated）可讀取、更新處理狀態
CREATE POLICY inquiries_authenticated_select ON public.inquiries FOR SELECT TO authenticated USING (true);
CREATE POLICY inquiries_authenticated_update ON public.inquiries FOR UPDATE TO authenticated USING (true);
