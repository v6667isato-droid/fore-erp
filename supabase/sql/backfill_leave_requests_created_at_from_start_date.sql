-- 一次性：將 leave_requests.created_at 對齊請假起始日 start_date（當日 00:00，Asia/Taipei）。
-- 執行前請先跑下方「預覽」SELECT；確認後再執行 UPDATE。
--
-- 說明：
-- - created_at 為 timestamptz；start_date 為 date。
-- - 下列寫法將「該曆日的開始」轉成 timestamptz，與台灣日曆日一致。
-- - 若只想改特休，請改用註解中的 WHERE。

-- ========== 1) 預覽（建議先執行）==========
-- SELECT
--   id,
--   leave_type,
--   start_date,
--   created_at AS created_at_before,
--   (start_date::timestamp AT TIME ZONE 'Asia/Taipei') AS created_at_after
-- FROM public.leave_requests
-- ORDER BY start_date DESC
-- LIMIT 50;

-- ========== 2) 正式更新 ==========
BEGIN;

UPDATE public.leave_requests
SET created_at = (start_date::timestamp AT TIME ZONE 'Asia/Taipei')
WHERE true;
-- 若僅特休：
-- WHERE trim(leave_type) = '特休';

COMMIT;

-- ========== 3) 還原參考（僅備註；無法還原舊值除非有備份）==========
-- 建議執行 UPDATE 前先匯出或：
-- CREATE TABLE leave_requests_backup_YYYYMMDD AS TABLE public.leave_requests;
