-- 若 overtime_records 為手動建立且未含 created_by，RPC INSERT 會失敗；此檔補欄位
ALTER TABLE public.overtime_records
ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.overtime_records.created_by IS '核准操作之 auth user（approve_overtime_to_comp_leave 寫入）';
