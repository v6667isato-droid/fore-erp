-- 工單排程：與訂單交期（orders.expected_delivery_date）分開，供生產端自行調整
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS planned_start_date date,
  ADD COLUMN IF NOT EXISTS planned_end_date date;

COMMENT ON COLUMN public.work_orders.planned_start_date IS '生產預計開工日（選填）';
COMMENT ON COLUMN public.work_orders.planned_end_date IS '生產預計完成日；與客戶交期不同，可由生產管理修改';
