-- /portal（通路下單）改成「選系列 → 木種 → 尺寸／座墊」逐步挑選規格，
-- 需以 anon 讀選項軸名稱與排序（product_variants 的 wood_value_id 等只有 id）。
-- 比照 20260627151000_restore_anon_catalog_read_for_portal：產品目錄唯讀開放，
-- 寫入仍只限 authenticated（option_types_authenticated_all／option_values_authenticated_all）。
CREATE POLICY option_types_anon_select ON public.option_types FOR SELECT TO anon USING (true);
CREATE POLICY option_values_anon_select ON public.option_values FOR SELECT TO anon USING (true);
