-- 一次性：既有工單之預計完成日改為所屬訂單交期（orders.expected_delivery_date）
-- 僅更新訂單有填交期之列；無交期者不改動 planned_end_date
UPDATE public.work_orders AS wo
SET planned_end_date = (o.expected_delivery_date)::date
FROM public.order_items AS oi
JOIN public.orders AS o ON o.id = oi.order_id
WHERE wo.order_item_id = oi.id
  AND o.expected_delivery_date IS NOT NULL;
