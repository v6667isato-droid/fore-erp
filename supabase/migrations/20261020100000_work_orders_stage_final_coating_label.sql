-- 工單工序：「塗裝中(二)」更名為「塗裝中(最終塗裝)」（與應用程式 work-order-stages.ts 一致）
-- 更名期間暫停工序紀錄／歷程與 updated_at trigger，避免寫入今天日期的假異動
-- （椅子生產表「噴漆階段」取 work_order_stage_logs 最新一筆，會被覆蓋成更名當天）。
ALTER TABLE public.work_orders DISABLE TRIGGER work_orders_log_stage_change;
ALTER TABLE public.work_orders DISABLE TRIGGER work_orders_log_stage_change_update;
ALTER TABLE public.work_orders DISABLE TRIGGER work_orders_set_updated_at;

UPDATE public.work_orders
SET stage = '塗裝中(最終塗裝)'
WHERE stage = '塗裝中(二)';

ALTER TABLE public.work_orders ENABLE TRIGGER work_orders_log_stage_change;
ALTER TABLE public.work_orders ENABLE TRIGGER work_orders_log_stage_change_update;
ALTER TABLE public.work_orders ENABLE TRIGGER work_orders_set_updated_at;

UPDATE public.work_order_stage_logs
SET stage = '塗裝中(最終塗裝)'
WHERE stage = '塗裝中(二)';

UPDATE public.work_order_stage_history
SET old_stage = '塗裝中(最終塗裝)'
WHERE old_stage = '塗裝中(二)';

UPDATE public.work_order_stage_history
SET new_stage = '塗裝中(最終塗裝)'
WHERE new_stage = '塗裝中(二)';
