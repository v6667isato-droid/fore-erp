-- 發票來源標記＋Gmail 自動抓取欄位
-- source：manual=手動輸入 / upload=手動上傳 / gmail=Gmail 自動抓取
ALTER TABLE accounting_invoices
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS gmail_message_id text,
  ADD COLUMN IF NOT EXISTS gmail_subject text,
  ADD COLUMN IF NOT EXISTS gmail_from text;

COMMENT ON COLUMN accounting_invoices.source IS '來源：manual=手動輸入 / upload=手動上傳 / gmail=Gmail 自動抓取';
COMMENT ON COLUMN accounting_invoices.gmail_message_id IS 'Gmail 訊息 id；防重複匯入（比對時含已刪除紀錄，刪過的信不再重抓）';
COMMENT ON COLUMN accounting_invoices.gmail_subject IS 'Gmail 信件主旨（來源追溯用）';
COMMENT ON COLUMN accounting_invoices.gmail_from IS 'Gmail 寄件者（來源追溯用）';

CREATE INDEX IF NOT EXISTS accounting_invoices_gmail_msg_idx
  ON accounting_invoices (gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;
