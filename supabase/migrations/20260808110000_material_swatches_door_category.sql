-- 材料色樣新增分類：door（門片種類），與 wood（材種）、fabric（布墊）並列
ALTER TABLE material_swatches DROP CONSTRAINT IF EXISTS material_swatches_category_check;
ALTER TABLE material_swatches ADD CONSTRAINT material_swatches_category_check
  CHECK (category IN ('wood', 'fabric', 'door'));

COMMENT ON TABLE material_swatches IS '材料色樣主檔（介紹表第二頁色樣區）：category wood=材種 / fabric=布墊 / door=門片種類';
