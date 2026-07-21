-- 發放紀錄的營收、成本改為獨立欄位（原本只存在 profit_meta 文字內），方便跨期統計。
-- 公司留存不另存：可由 profit − profit_sharing_pool − share_bonus_pool 推導。
ALTER TABLE performance_bonus_issuances
  ADD COLUMN IF NOT EXISTS revenue numeric,
  ADD COLUMN IF NOT EXISTS cost numeric;

COMMENT ON COLUMN performance_bonus_issuances.revenue IS '當期營收（半年毛利統計的營收合計）';
COMMENT ON COLUMN performance_bonus_issuances.cost IS '當期成本（半年毛利統計的成本合計）';

-- 既有紀錄自 profit_meta（「…營收 X、成本 Y」）回填
UPDATE performance_bonus_issuances
SET
  revenue = NULLIF(replace((regexp_match(profit_meta, '營收\s*([\d,]+)'))[1], ',', ''), '')::numeric,
  cost = NULLIF(replace((regexp_match(profit_meta, '成本\s*([\d,]+)'))[1], ',', ''), '')::numeric
WHERE profit_meta IS NOT NULL AND revenue IS NULL AND cost IS NULL;
