-- 舊表若未含 user_id，INSERT／RLS 若引用此欄會與程式不一致
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.leave_requests.user_id IS '選填：送出請假當下之 auth user；權限仍以 employee_id 對應 user_profiles 為準';
