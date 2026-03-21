-- 管理／主管可讀取所有假單（假單審核、公司行事曆顯示已核准區間）
-- 與 leave_requests_select_own 並存：RLS 多則 SELECT 為 OR
CREATE POLICY "leave_requests_select_admin_manager"
  ON public.leave_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.user_id = auth.uid()
        AND lower(trim(COALESCE(up.role::text, ''))) IN ('admin', 'manager')
    )
  );
