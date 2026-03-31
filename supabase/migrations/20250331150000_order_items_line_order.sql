-- 訂單明細列順序（愈小愈前），供編輯訂單時自由排列品項
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS line_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN order_items.line_order IS '明細列順序（0 起算，愈小愈前）';

UPDATE order_items oi
SET line_order = sub.rn
FROM (
  SELECT
    id,
    (ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY id) - 1)::integer AS rn
  FROM order_items
) sub
WHERE oi.id = sub.id;

CREATE INDEX IF NOT EXISTS idx_order_items_order_line
  ON order_items (order_id, line_order);
