-- 允許更新 vendors.name 時，自動套用到 purchases.vendor_name，並在刪除廠商時避免錯誤

ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_vendor_name_fkey;

ALTER TABLE purchases
  ADD CONSTRAINT purchases_vendor_name_fkey
  FOREIGN KEY (vendor_name)
  REFERENCES vendors(name)
  ON UPDATE CASCADE
  ON DELETE SET NULL;

