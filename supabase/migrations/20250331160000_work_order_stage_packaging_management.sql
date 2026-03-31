-- 工序名稱：包裝檢查 → 包裝管理（與應用程式 work-order-stages.ts 一致）
UPDATE work_orders SET stage = '包裝管理' WHERE stage = '包裝檢查';
