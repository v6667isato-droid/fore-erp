-- production_tasks.work_order_id 一直缺 FK,PostgREST 不認得與 work_orders 的關聯,
-- 員工儀表板「生產交辦」的巢狀查詢因此整批失敗回空(2026-07-21 發現)。表為空,加約束無資料風險。
-- (已於 2026-07-21 經 MCP apply_migration 套用至正式庫,此檔為版本紀錄)
ALTER TABLE public.production_tasks
  ADD CONSTRAINT production_tasks_work_order_id_fkey
  FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id) ON DELETE SET NULL;
