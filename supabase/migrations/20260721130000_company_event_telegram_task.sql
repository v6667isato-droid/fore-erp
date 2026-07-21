-- Telegram 交辦改寫入 company_event + company_event_assignees(與開會/行事曆交辦同清單顯示)
-- (已於 2026-07-21 經 MCP apply_migration 套用至正式庫,此檔為版本紀錄)
ALTER TABLE public.company_event ADD COLUMN IF NOT EXISTS image_url text;
COMMENT ON COLUMN public.company_event.image_url IS '交辦附圖(Telegram bot 指派時上傳至 Storage task-images bucket 的公開 URL)';

-- 交辦可帶期限(AI 解析,無則預設當天),經確認流程帶入 event_date
ALTER TABLE public.telegram_pending_tasks ADD COLUMN IF NOT EXISTS due_date date;
