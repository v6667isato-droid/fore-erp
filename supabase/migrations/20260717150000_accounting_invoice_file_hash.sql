-- Gmail 匯入防重複：附件內容 SHA-256（轉寄信的附件位元組相同，靠內容雜湊跨信件去重）
ALTER TABLE accounting_invoices
  ADD COLUMN IF NOT EXISTS file_hash text;

COMMENT ON COLUMN accounting_invoices.file_hash IS '附件內容 SHA-256（hex）；Gmail 匯入跨信件去重用（比對含已刪除紀錄）';

CREATE INDEX IF NOT EXISTS accounting_invoices_file_hash_idx
  ON accounting_invoices (file_hash)
  WHERE file_hash IS NOT NULL;
