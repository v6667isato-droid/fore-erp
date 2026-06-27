-- 20260627150000_enable_rls_internal_tables.sql 鎖太多了：
-- /portal（客戶下單頁）會以 anon 直接讀 product_variants / product_series /
-- product_series_channel_discounts 來組出可下單商品列表與通路折扣，
-- 鎖成 authenticated only 後客戶端商品目錄直接打不開。補回唯讀 anon 政策。
CREATE POLICY product_variants_anon_select ON public.product_variants FOR SELECT TO anon USING (true);
CREATE POLICY product_series_anon_select ON public.product_series FOR SELECT TO anon USING (true);
CREATE POLICY product_series_channel_discounts_anon_select ON public.product_series_channel_discounts FOR SELECT TO anon USING (true);
