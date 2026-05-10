-- 工單工序：「包裝管理」更名為「塗裝後製程」（與應用程式 work-order-stages.ts 一致）
UPDATE public.work_orders
SET stage = '塗裝後製程'
WHERE stage = '包裝管理';
