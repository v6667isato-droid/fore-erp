-- 儀表板打卡開放範圍：off=關閉／admin=僅管理員測試／all=全員
-- 測試期先 admin；驗證後由管理端把值改為 "all" 即可開放，全程不用重新部署。
INSERT INTO
  public.app_settings (key, value, description)
VALUES
  (
    'portal_checkin_scope',
    '"admin"',
    '儀表板打卡開放範圍（off／admin／all）；測試期僅管理員可打，驗證後改 all 開放全員'
  )
ON CONFLICT (key) DO NOTHING;
