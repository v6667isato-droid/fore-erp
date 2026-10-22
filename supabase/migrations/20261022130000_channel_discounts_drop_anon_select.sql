-- 通路折扣（product_series_channel_discounts）移除 anon 讀取。
-- 原本 /portal 以 anon 直讀，任何拿到前端公開金鑰的人都能看到所有通路的折扣 %。
-- 改由 /api/portal/channel-discounts 驗 portal_token 後只回傳該通路自己的折扣。
--
-- ⚠️ 套用順序：必須等「通路折扣改走 API」的程式部署上線後才能執行，
-- 否則線上版通路下單頁讀不到折扣，可下單品項會變成空的。
-- ERP（authenticated）走 product_series_channel_discounts_authenticated_all，不受影響。

DROP POLICY IF EXISTS product_series_channel_discounts_anon_select ON public.product_series_channel_discounts;
