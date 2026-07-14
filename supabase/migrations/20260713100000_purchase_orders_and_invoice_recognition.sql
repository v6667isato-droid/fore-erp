-- 採購單單頭：每張採購單一個編號，整合多筆採購明細（purchases 為單身）
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL UNIQUE,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  -- 不設 vendors FK：請款單辨識出的廠商可能尚未建主檔
  vendor_name text,
  notes text,
  -- 請款單附件：[{ url, path, name, uploaded_at }]
  invoice_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE purchase_orders IS '採購單單頭；purchases 為其品項明細（purchase_order_id）';
COMMENT ON COLUMN purchase_orders.po_number IS '採購單編號（PO-YYYYMMDD-xxx；轉檔資料為 3 碼流水、新單為 4 碼時間戳尾碼）';
COMMENT ON COLUMN purchase_orders.invoice_files IS '廠商請款單附件 JSON 陣列：[{url, path, name, uploaded_at}]（purchase-invoices bucket）';

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS purchases_purchase_order_id_idx ON purchases (purchase_order_id);

-- 舊資料併單：同廠商＋同日期的明細併成一張採購單（含已軟刪除者，維持關聯完整）
WITH groups AS (
  SELECT
    purchase_date,
    COALESCE(vendor_name, '') AS vendor_key,
    row_number() OVER (PARTITION BY purchase_date ORDER BY COALESCE(vendor_name, '')) AS rn
  FROM purchases
  WHERE purchase_order_id IS NULL
  GROUP BY purchase_date, COALESCE(vendor_name, '')
),
ins AS (
  INSERT INTO purchase_orders (po_number, purchase_date, vendor_name)
  SELECT
    'PO-' || to_char(purchase_date, 'YYYYMMDD') || '-' || lpad(rn::text, 3, '0'),
    purchase_date,
    NULLIF(vendor_key, '')
  FROM groups
  RETURNING id, purchase_date, COALESCE(vendor_name, '') AS vendor_key
)
UPDATE purchases p
SET purchase_order_id = i.id
FROM ins i
WHERE p.purchase_order_id IS NULL
  AND p.purchase_date = i.purchase_date
  AND COALESCE(p.vendor_name, '') = i.vendor_key;

-- 廠商品名→料號記憶：請款單辨識人工審核確認後寫入，下次同廠商自動帶入
CREATE TABLE IF NOT EXISTS vendor_item_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- '' 表示不限廠商
  vendor_name text NOT NULL DEFAULT '',
  -- 正規化後的廠商品名（小寫、去空白）
  alias_text text NOT NULL,
  material_id uuid NOT NULL REFERENCES procurement_materials(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (vendor_name, alias_text)
);

COMMENT ON TABLE vendor_item_aliases IS '廠商請款單品名→採購物料主檔對應記憶（AI 辨識審核時自動帶入）';

-- RLS：比照其他內部表（已登入即可完整存取）
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_authenticated_all ON purchase_orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE vendor_item_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendor_item_aliases_authenticated_all ON vendor_item_aliases
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 請款單附件 Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('purchase-invoices', 'purchase-invoices', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "purchase_invoices_upload" ON storage.objects;
DROP POLICY IF EXISTS "purchase_invoices_update" ON storage.objects;
DROP POLICY IF EXISTS "purchase_invoices_delete" ON storage.objects;
DROP POLICY IF EXISTS "purchase_invoices_public_read" ON storage.objects;

CREATE POLICY "purchase_invoices_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'purchase-invoices');

CREATE POLICY "purchase_invoices_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'purchase-invoices');

CREATE POLICY "purchase_invoices_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'purchase-invoices');

CREATE POLICY "purchase_invoices_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'purchase-invoices');
