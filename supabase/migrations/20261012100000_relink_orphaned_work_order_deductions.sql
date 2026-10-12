-- 修正：編輯訂單時以前會「刪除全部品項與工單 → 整批重建」，已開工自動扣帳的
-- stock_movements.work_order_id 因 FK on delete set null 變成 NULL。重建後的新工單查不到
-- 自己的扣帳，下次換工序時 work_orders_auto_deduct_parts 會再扣一次料。
-- 前端已改為沿用原品項／工單（src/lib/order-items-save.ts），本檔把既有的孤兒扣帳接回目前的工單。
--
-- 對應方式（全部取自 audit_logs，只接回唯一對應的列）：
--   扣帳 INSERT 紀錄的 work_order_id（原工單）
--   → 原工單 DELETE 紀錄的 order_item_id（原品項）
--   → 原品項 DELETE 紀錄的 variant_id／line_order
--   → 同訂單目前相同規格的品項（不只一筆時再比 line_order）→ 該品項的工單
-- 接不回的（規格已換掉、扣帳早於 2026/8/6 audit_logs 開始記錄）維持原狀，由出貨對帳處理。
-- 2026-10-12 於正式庫試算：9 張訂單、68 筆可接回；目標工單皆尚無自己的扣帳。

with orphan as (
  select s.id, s.order_id
    from public.stock_movements s
   where s.movement_type = '領用'
     and s.order_id is not null
     and s.work_order_id is null
),
chain as (
  select o.id as movement_id, o.order_id,
         item_del.old_data ->> 'variant_id' as old_variant,
         (item_del.old_data ->> 'line_order')::int as old_line
    from orphan o
    join lateral (
      select a.new_data ->> 'work_order_id' as work_order_id
        from public.audit_logs a
       where a.table_name = 'stock_movements' and a.action = 'INSERT' and a.record_id = o.id::text
       order by a.id limit 1
    ) mv_ins on mv_ins.work_order_id is not null
    join lateral (
      select a.old_data ->> 'order_item_id' as order_item_id
        from public.audit_logs a
       where a.table_name = 'work_orders' and a.action = 'DELETE' and a.record_id = mv_ins.work_order_id
       order by a.id limit 1
    ) wo_del on wo_del.order_item_id is not null
    join lateral (
      select a.old_data
        from public.audit_logs a
       where a.table_name = 'order_items' and a.action = 'DELETE' and a.record_id = wo_del.order_item_id
       order by a.id limit 1
    ) item_del on item_del.old_data ->> 'variant_id' is not null
),
candidates as (
  select c.movement_id, w.id as work_order_id, (oi.line_order = c.old_line) as same_line,
         count(*) over (partition by c.movement_id) as n_same_variant
    from chain c
    join public.order_items oi
      on oi.order_id = c.order_id and oi.variant_id::text = c.old_variant
    join public.work_orders w on w.order_item_id = oi.id
),
picked as (
  select movement_id, (array_agg(work_order_id))[1] as work_order_id
    from candidates
   where n_same_variant = 1 or same_line
   group by movement_id
  having count(*) = 1
)
update public.stock_movements s
   set work_order_id = p.work_order_id
  from picked p
 where s.id = p.movement_id
   and s.work_order_id is null
   -- 目標工單已有自己的扣帳時不接回，避免掩蓋真正的重複扣帳
   and not exists (
     select 1 from public.stock_movements x
      where x.work_order_id = p.work_order_id and x.movement_type = '領用'
   );
