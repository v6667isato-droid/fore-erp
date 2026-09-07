-- 發票來源新增「採購單匯入」：
-- 員工把統一發票誤傳到採購請款單佇列時，AI 辨識出是統一發票（is_tax_invoice），
-- 採購審核建檔後會自動複製附件進會計發票佇列（source=po_import）並對應該張採購單。
COMMENT ON COLUMN accounting_invoices.source IS
  '來源：manual=手動輸入 / upload=手動上傳 / gmail=Gmail 自動抓取 / po_import=採購單匯入（採購佇列辨識為統一發票自動同步）';
