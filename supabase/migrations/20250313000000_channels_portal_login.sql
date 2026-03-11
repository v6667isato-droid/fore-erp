-- 通路登入資訊移到 channels 表：每個通路一組代碼與密碼
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS portal_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS portal_password text;

COMMENT ON COLUMN channels.portal_code IS '通路下單入口登入代碼，唯一';
COMMENT ON COLUMN channels.portal_password IS '通路下單入口密碼（建議正式環境改為雜湊儲存）';

