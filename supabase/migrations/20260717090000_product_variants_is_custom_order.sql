-- 訂製款規格旗標：訂單新增時可選，但不列入產品介紹表、價目表等對外列表
alter table product_variants
  add column if not exists is_custom_order boolean not null default false;

comment on column product_variants.is_custom_order is
  '訂製款（開單佔位用規格）：true 時不顯示於產品介紹表／價目表等對外列表，訂單牌價改為手動輸入';

-- 回填既有訂製款（目前慣例：產品代碼以 -C 結尾，如 CB03-C、TB01-C）
update product_variants
set is_custom_order = true
where product_code like '%-C';
