-- 椅類產品規格：扶手高度（cm），英文標示 AH
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS arm_height_cm numeric;

COMMENT ON COLUMN product_variants.arm_height_cm IS '扶手高度（cm，英文標示 AH），有扶手之椅類使用；未填寫者不在訂單／產品資料表顯示';
