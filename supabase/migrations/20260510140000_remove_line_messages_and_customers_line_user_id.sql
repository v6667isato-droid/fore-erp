-- 移除 LINE 客戶訊息收件匣（line_messages）與客戶主檔的 Messaging API userId（line_user_id）。
-- 員工 LINE 綁定／打卡仍使用 employees.line_user_id，不受此 migration 影響。

DROP TABLE IF EXISTS public.line_messages;

ALTER TABLE public.customers DROP COLUMN IF EXISTS line_user_id;
