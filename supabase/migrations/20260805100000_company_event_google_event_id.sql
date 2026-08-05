-- Google 行事曆同步：記錄事件在 Google Calendar 上對應的 event id。
-- null = 尚未同步（cron 對帳會補建）。刪除 ERP 事件時由 /api/calendar-sync 刪 Google 端。
alter table public.company_event
  add column if not exists google_event_id text;

comment on column public.company_event.google_event_id is
  'Google Calendar 事件 id（/api/calendar-sync 寫入）；null 表示尚未同步';
