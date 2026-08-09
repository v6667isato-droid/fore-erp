-- 材料色樣新增分類：cloth（布樣）；fabric 顯示名由「布墊」改為「座墊」（UI 層變更，值不動）
ALTER TABLE material_swatches DROP CONSTRAINT IF EXISTS material_swatches_category_check;
ALTER TABLE material_swatches ADD CONSTRAINT material_swatches_category_check
  CHECK (category IN ('wood', 'fabric', 'door', 'cloth'));

COMMENT ON TABLE material_swatches IS '材料色樣主檔（介紹表第二頁色樣區）：category wood=材種 / fabric=座墊 / door=門片種類 / cloth=布樣';
