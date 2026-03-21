-- 台灣 2026（民國115）行政機關放假日（人事總處行事曆；實際以 dgpa 公告為準）
-- 僅作為起始資料；與手動維護一樣寫入 public_holidays，已存在同日則略過。
-- 2026 年起官方行事曆取消補班日，故無 is_workday=true 之列。

INSERT INTO public.public_holidays (holiday_date, name, is_workday, is_paid)
VALUES
  ('2026-01-01', '元旦', false, true),
  ('2026-02-14', '農曆春節', false, true),
  ('2026-02-15', '農曆春節', false, true),
  ('2026-02-16', '農曆春節', false, true),
  ('2026-02-17', '農曆春節', false, true),
  ('2026-02-18', '農曆春節', false, true),
  ('2026-02-19', '農曆春節', false, true),
  ('2026-02-20', '農曆春節', false, true),
  ('2026-02-21', '農曆春節', false, true),
  ('2026-02-22', '農曆春節', false, true),
  ('2026-02-27', '和平紀念日（228）', false, true),
  ('2026-02-28', '和平紀念日（228）', false, true),
  ('2026-03-01', '和平紀念日（228）', false, true),
  ('2026-04-03', '兒童節及清明節', false, true),
  ('2026-04-04', '兒童節及清明節', false, true),
  ('2026-04-05', '兒童節及清明節', false, true),
  ('2026-04-06', '兒童節及清明節', false, true),
  ('2026-05-01', '勞動節', false, true),
  ('2026-06-19', '端午節', false, true),
  ('2026-06-20', '端午節', false, true),
  ('2026-06-21', '端午節', false, true),
  ('2026-09-25', '中秋節（暨教師節）', false, true),
  ('2026-09-26', '中秋節（暨教師節）', false, true),
  ('2026-09-27', '中秋節（暨教師節）', false, true),
  ('2026-09-28', '中秋節（暨教師節）', false, true),
  ('2026-09-29', '中秋節（暨教師節）', false, true),
  ('2026-10-09', '國慶日', false, true),
  ('2026-10-10', '國慶日', false, true),
  ('2026-10-11', '國慶日', false, true),
  ('2026-10-24', '台灣光復節', false, true),
  ('2026-10-25', '台灣光復節', false, true),
  ('2026-10-26', '台灣光復節', false, true),
  ('2026-12-25', '行憲紀念日', false, true),
  ('2026-12-26', '行憲紀念日', false, true),
  ('2026-12-27', '行憲紀念日', false, true)
ON CONFLICT (holiday_date) DO NOTHING;
