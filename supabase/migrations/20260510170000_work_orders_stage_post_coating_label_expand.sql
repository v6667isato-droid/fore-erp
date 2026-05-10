-- 工單工序站別顯示名稱擴充（與應用程式 work-order-stages.ts 一致）
UPDATE public.work_orders
SET stage = '塗裝後製程(組配、編織)'
WHERE stage = '塗裝後製程';
