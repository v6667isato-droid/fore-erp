-- Telegram bot 生產交辦:production_tasks 補欄位 + bot 待確認暫存表 + 附圖 bucket
-- employee_id 是員工儀表板「生產交辦」查詢用的欄位(前端已支援,缺欄位時 fallback 回空)
-- (已於 2026-07-21 經 MCP apply_migration 套用至正式庫,此檔為版本紀錄)

ALTER TABLE public.production_tasks
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS report text,
  ADD COLUMN IF NOT EXISTS reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS source varchar DEFAULT 'erp';

COMMENT ON COLUMN public.production_tasks.employee_id IS '承辦員工(員工儀表板生產交辦查詢欄位;Telegram 指派的獨立任務用此欄)';
COMMENT ON COLUMN public.production_tasks.image_url IS '交辦附圖(Supabase Storage task-images bucket 公開 URL)';
COMMENT ON COLUMN public.production_tasks.report IS '完成回報內容(例:W-3組 O-4組;W=胡桃 O=橡木),員工儀表板填寫';
COMMENT ON COLUMN public.production_tasks.reported_at IS '回報/完成時間';
COMMENT ON COLUMN public.production_tasks.source IS '任務來源:erp | telegram(Telegram bot 指派)';

-- bot 預覽確認暫存表(bot 自有,走 service role;RLS enabled 無 policy,同 telegram_conversations)
CREATE TABLE IF NOT EXISTS public.telegram_pending_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id text NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  employee_name text NOT NULL,
  title text NOT NULL,
  image_url text,
  status text NOT NULL DEFAULT 'pending', -- pending | confirmed | cancelled
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_pending_tasks ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.telegram_pending_tasks IS 'Telegram bot 交辦預覽暫存:按「確認」後才寫入 production_tasks';

-- 交辦附圖 bucket(公開讀取,與其他 bucket 一致)
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-images', 'task-images', true)
ON CONFLICT (id) DO NOTHING;
