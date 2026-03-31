-- 週五工坊設備維護輪替（由開會紀錄維護；儀表板顯示「最近一次開會日期」對應名單）
ALTER TABLE employees.meeting_minutes
  ADD COLUMN IF NOT EXISTS workshop_rotation_vertical uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS workshop_rotation_hand uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS workshop_rotation_supervisor uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS workshop_rotation_duty uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN employees.meeting_minutes.workshop_rotation_vertical IS '週五工坊：立式機具保養（最多 2 人）';
COMMENT ON COLUMN employees.meeting_minutes.workshop_rotation_hand IS '週五工坊：手工機具保養（最多 1 人）';
COMMENT ON COLUMN employees.meeting_minutes.workshop_rotation_supervisor IS '週五工坊：機動監督（最多 1 人）';
COMMENT ON COLUMN employees.meeting_minutes.workshop_rotation_duty IS '週五工坊：值日生（最多 1 人）';
