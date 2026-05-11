-- 工單工序：「製作中」更名為「零部件製作中」（與應用程式 work-order-stages.ts 一致）
UPDATE public.work_orders
SET stage = '零部件製作中'
WHERE stage = '製作中';
