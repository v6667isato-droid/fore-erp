-- 材料色樣新增 code（布樣編號）：布料廠商的型號／色號，與廠商溝通叫布時使用。
-- 目前 UI 只在「布樣」分類顯示與編輯；不印在產品介紹表上。
ALTER TABLE material_swatches ADD COLUMN IF NOT EXISTS code text;

COMMENT ON COLUMN material_swatches.code IS '布樣編號（布料廠商的型號／色號，與廠商溝通用；不印在介紹表）';
