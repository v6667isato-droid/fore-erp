-- 假別主檔：申請表單下拉、規則說明（員工）與審核須知（審核者）皆由此表驅動。
-- 額度型（特休／補休）餘額沿用既有 employees.annual_leave_remaining / comp_leave_remaining 機制；
-- 其餘假別不預存餘額，年度累計一律由 approved 的 leave_requests 加總計算。
create table if not exists public.leave_types (
  code            text primary key,
  name            text not null unique,
  category        text not null check (category in ('balance', 'event', 'general', 'maternity')),
  tracks_balance  boolean not null default false,
  statutory_days  numeric,
  annual_limit_days numeric,
  pay_ratio       numeric not null default 1.0,
  proof_required  text not null default 'optional'
    check (proof_required in ('never', 'optional', 'required', 'over_n_days')),
  proof_threshold_days numeric,
  description     text,
  approval_notes  text,
  sort_order      integer not null default 0,
  active          boolean not null default true,
  -- 性別平等工作法：生理假不得要求證明，禁止改成其他值
  constraint leave_types_menstrual_no_proof
    check (code <> 'menstrual' or proof_required = 'never')
);

comment on table public.leave_types is '假別主檔；leave_requests.leave_type 以 name（中文顯示名）對應本表';

alter table public.leave_types enable row level security;

drop policy if exists leave_types_authenticated_select on public.leave_types;
create policy leave_types_authenticated_select
  on public.leave_types for select to authenticated using (true);
-- 不開放 client 端寫入；調整假別規則請走 SQL / migration。

insert into public.leave_types
  (code, name, category, tracks_balance, statutory_days, annual_limit_days, pay_ratio,
   proof_required, proof_threshold_days, description, approval_notes, sort_order, active)
values
  ('annual', '特休', 'balance', true, null, null, 1.0, 'never', null,
   '依年資產生之特別休假，全薪。未休完依法折現或經同意遞延一年。',
   '確認餘額足夠即可核准。', 1, true),
  ('comp', '補休', 'balance', true, null, null, 1.0, 'never', null,
   '加班換得之補休，全薪。補休期限內未休完應回歸加班費發給。',
   '確認餘額足夠。留意補休期限。', 2, true),
  ('personal', '事假', 'general', false, null, 14, 0, 'optional', null,
   '因有事故必須親自處理者可請事假，一年合計不得超過 14 日，不給薪。',
   '檢查年度累計（含家庭照顧假）是否超過 14 日，超過須協商以特休抵充或留職停薪。', 3, true),
  ('sick', '病假', 'general', false, null, 30, 0.5, 'over_n_days', 3,
   '未住院傷病假一年合計不得超過 30 日，30 日內半薪。可以小時為單位申請。連續 3 日以上須附就醫證明。',
   '一年內病假未超過 10 日者，依法不得作任何不利處分（扣考績、減薪等）。30 日為半薪上限，超過經抵充仍未痊癒得留職停薪（以一年為限）。全勤獎金僅得按比例扣除。', 4, true),
  ('menstrual', '生理假', 'general', false, null, null, 0.5, 'never', null,
   '每月得請生理假 1 日，半薪。無須提供任何證明。',
   '依性別平等工作法，雇主不得要求任何證明文件。每年 3 日內不併入病假，超過部分併入病假 30 日計算。', 5, true),
  ('family_care', '家庭照顧假', 'general', false, null, 14, 0, 'optional', null,
   '為親自照顧家庭成員可請家庭照顧假，併入事假 14 日額度計算，不給薪，可以小時為單位。',
   '併入事假年度 14 日計算，但依法不得扣全勤。', 6, true),
  ('marriage', '婚假', 'event', false, 8, null, 1.0, 'required', null,
   '結婚可請婚假 8 日，全薪。應於結婚登記日前 10 日起 3 個月內請畢（經同意可延至 1 年），可拆分請領。',
   '須附結婚書約或戶籍謄本。核對登記日期是否在請假效期內。逾期權利消失，不得折現。不得扣全勤。', 7, true),
  ('funeral_8', '喪假(8日)', 'event', false, 8, null, 1.0, 'required', null,
   '父母、養父母、繼父母、配偶喪亡，給喪假 8 日，全薪。',
   '須附訃聞或死亡證明，核對親屬關係。得分次請畢。不得扣全勤。', 8, true),
  ('funeral_6', '喪假(6日)', 'event', false, 6, null, 1.0, 'required', null,
   '祖父母、子女、配偶之父母／養父母／繼父母喪亡，給喪假 6 日，全薪。',
   '同喪假(8日)：附訃聞或死亡證明，核對親等。得分次請畢。不得扣全勤。', 9, true),
  ('funeral_3', '喪假(3日)', 'event', false, 3, null, 1.0, 'required', null,
   '曾祖父母、兄弟姊妹、配偶之祖父母喪亡，給喪假 3 日，全薪。',
   '同喪假(8日)：附訃聞或死亡證明，核對親等。得分次請畢。不得扣全勤。', 10, true),
  ('official', '公假', 'event', false, null, null, 1.0, 'required', null,
   '兵役召集、法院傳喚、依法投票等公務事由，依實際需要天數給假，全薪。',
   '須附通知書等公文件。不得扣全勤。', 11, true),
  ('occupational', '公傷病假', 'event', false, null, null, 1.0, 'required', null,
   '因職業災害致傷病之治療休養期間給公傷病假，全薪，無天數上限。',
   '涉及職災認定，核准前先確認勞保職災程序，必要時洽勞保局。醫療終止前均得請假。', 12, true),
  ('maternity', '產假', 'maternity', false, 56, null, 1.0, 'required', null,
   '分娩前後給產假 8 星期（含例休假日）。年資滿一年全薪，未滿一年半薪。',
   '附出生證明。薪資依年資判斷：滿一年全薪，未滿半薪。', 13, true),
  ('prenatal', '產檢假', 'maternity', false, 7, null, 1.0, 'optional', null,
   '妊娠期間產檢假 7 日，全薪。',
   '得附產檢紀錄。', 14, true),
  ('paternity', '陪產檢及陪產假', 'maternity', false, 7, null, 1.0, 'optional', null,
   '配偶妊娠產檢或分娩，陪產檢及陪產假合計 7 日，全薪。',
   '得附相關證明。', 15, true),
  ('miscarriage', '流產假', 'maternity', false, null, null, 1.0, 'required', null,
   '依妊娠週數：滿 3 個月給 4 星期、2–3 個月給 1 星期、未滿 2 個月給 5 日。',
   '附診斷證明，依週數核給天數與薪資（未滿三個月流產之產假雇主得不給薪，細節核准時確認）。', 16, true),
  ('parental_leave', '育嬰留職停薪', 'maternity', false, null, null, 0, 'required', null,
   '子女滿 3 歲前得申請育嬰留職停薪，最長 2 年，不給薪（勞保有津貼可申請）。',
   '這是留職停薪不是一般假單，核准後須處理勞健保與津貼申請流程。', 17, true)
on conflict (code) do nothing;

-- 假單附件（診斷證明、訃聞等）：儲存 leave-attachments bucket 內的物件路徑
alter table public.leave_requests add column if not exists attachment_url text;
