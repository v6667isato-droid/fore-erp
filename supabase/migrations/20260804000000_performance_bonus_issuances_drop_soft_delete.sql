-- 考績獎金發放紀錄改為硬刪除：
-- 1) 先清掉既有軟刪除資料（明細列由 FK CASCADE 一併刪除）
-- 2) 移除 deleted_at 欄位（相依的 partial index 會自動一併移除），改建一般期別索引
DELETE FROM performance_bonus_issuances WHERE deleted_at IS NOT NULL;

ALTER TABLE performance_bonus_issuances DROP COLUMN IF EXISTS deleted_at;

CREATE INDEX IF NOT EXISTS performance_bonus_issuances_period_idx
  ON performance_bonus_issuances (year, half);
