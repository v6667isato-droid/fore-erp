-- 工單工序站別與應用程式 work-order-stages.ts 對齊（舊字串一次性遷移）
UPDATE work_orders SET stage = '備料中' WHERE stage = '開料中';
UPDATE work_orders SET stage = '組裝中(一)' WHERE stage = '組裝中';
UPDATE work_orders SET stage = '包裝管理' WHERE stage IN ('品檢中', '品檢／包裝', '包裝檢查');
UPDATE work_orders SET stage = '待出貨' WHERE stage = '成品';
