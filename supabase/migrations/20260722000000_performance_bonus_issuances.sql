-- 績效獎金發放紀錄：按「確定發放」時完整快照當期設定、加權與每位員工的計算結果，
-- 供日後查核；畫面上的草稿（localStorage）仍可繼續調整，不影響已存紀錄。
CREATE TABLE IF NOT EXISTS performance_bonus_issuances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  half text NOT NULL CHECK (half IN ('H1', 'H2')),
  -- 當期利潤（毛利合計或手動輸入值）與統計說明
  profit numeric NOT NULL DEFAULT 0,
  profit_meta text,
  profit_sharing_pct numeric NOT NULL DEFAULT 0,
  share_bonus_pct numeric NOT NULL DEFAULT 0,
  issue_year_end_bonus boolean NOT NULL DEFAULT false,
  -- 年終獎金＝月薪 ×（此 % ÷ 100）× 在職比例
  year_end_bonus_salary_pct numeric NOT NULL DEFAULT 0,
  -- 加權設定（能力分級／考績／年資／薪資）
  weight_ability numeric NOT NULL DEFAULT 0,
  weight_performance numeric NOT NULL DEFAULT 0,
  weight_seniority numeric NOT NULL DEFAULT 0,
  weight_salary numeric NOT NULL DEFAULT 0,
  -- 各獎金池金額
  profit_sharing_pool numeric NOT NULL DEFAULT 0,
  year_end_bonus_total numeric NOT NULL DEFAULT 0,
  weighted_profit_sharing_pool numeric NOT NULL DEFAULT 0,
  share_bonus_pool numeric NOT NULL DEFAULT 0,
  total_bonus numeric NOT NULL DEFAULT 0,
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE performance_bonus_issuances IS '績效獎金發放紀錄主檔：確定發放時的期別、設定與獎金池快照';

CREATE INDEX IF NOT EXISTS performance_bonus_issuances_period_idx
  ON performance_bonus_issuances (year, half) WHERE deleted_at IS NULL;

ALTER TABLE performance_bonus_issuances ENABLE ROW LEVEL SECURITY;
CREATE POLICY performance_bonus_issuances_authenticated_all ON performance_bonus_issuances
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 發放明細：每位員工當時的能力分級、考績、年資、薪資、各占比（%）與各項獎金
CREATE TABLE IF NOT EXISTS performance_bonus_issuance_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuance_id uuid NOT NULL REFERENCES performance_bonus_issuances(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  employee_name text NOT NULL,
  participates_in_profit_sharing boolean NOT NULL DEFAULT true,
  ability_grade numeric NOT NULL DEFAULT 0,
  performance numeric NOT NULL DEFAULT 0,
  -- 年資（十進位年數）與顯示用標籤（如「1年2月」）
  seniority_years numeric NOT NULL DEFAULT 0,
  seniority_label text,
  -- 該半年在職比例（0–1）
  tenure_ratio numeric NOT NULL DEFAULT 0,
  salary numeric NOT NULL DEFAULT 0,
  shares numeric NOT NULL DEFAULT 0,
  -- 各項占比（%）
  ability_pct numeric NOT NULL DEFAULT 0,
  performance_pct numeric NOT NULL DEFAULT 0,
  seniority_pct numeric NOT NULL DEFAULT 0,
  salary_pct numeric NOT NULL DEFAULT 0,
  total_pct numeric NOT NULL DEFAULT 0,
  -- 各項獎金金額
  year_end_bonus numeric NOT NULL DEFAULT 0,
  profit_sharing_bonus numeric NOT NULL DEFAULT 0,
  share_bonus numeric NOT NULL DEFAULT 0,
  total_bonus numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE performance_bonus_issuance_rows IS '績效獎金發放明細：每位員工當期的分級、占比與獎金快照';

CREATE INDEX IF NOT EXISTS performance_bonus_issuance_rows_issuance_idx
  ON performance_bonus_issuance_rows (issuance_id);
CREATE INDEX IF NOT EXISTS performance_bonus_issuance_rows_employee_idx
  ON performance_bonus_issuance_rows (employee_id);

ALTER TABLE performance_bonus_issuance_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY performance_bonus_issuance_rows_authenticated_all ON performance_bonus_issuance_rows
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
