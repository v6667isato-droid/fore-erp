-- 開啟 RLS：僅限「員工入口 / 客戶下單頁」皆不會以 anon 身份直接存取的內部表。
-- 維持現有「已登入即可完整存取」行為（與 company_event 既有政策一致），
-- 只是把目前對 anon 完全開放的存取面收掉。
-- 不含 customers / orders / order_items / work_orders / channels：
-- 客戶下單頁（/portal）與通路查詢頁（/channels/[channelId]/orders）目前以 anon key
-- 直接讀寫這幾張表，尚未有對應的身份驗證機制，鎖上會直接打壞這兩個功能，須另案處理。

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'employees',
    'production_tasks',
    'vendors',
    'purchases',
    'product_series',
    'product_variants',
    'project_progress',
    'user_profiles',
    'user_feedback',
    'product_variant_channel_prices',
    'product_series_channel_discounts',
    'payslips',
    'announcements',
    'employee_tasks',
    'leave_requests',
    'overtime_records',
    'daily_attendance',
    'public_holidays',
    'procurement_materials'
  ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true);',
      t || '_authenticated_all',
      t
    );
  END LOOP;
END $$;
