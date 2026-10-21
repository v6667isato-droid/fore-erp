-- 開工自動扣帳 trigger：生產站別加入「塗裝中(最終塗裝)」（「塗裝中(二)」更名，見 20261020100000）
-- 保留舊名稱「塗裝中(二)」，新舊版程式交替期間寫入舊字串仍會扣帳。
-- 函式本體除 production_stages 外與正式庫現行版本相同。
CREATE OR REPLACE FUNCTION public.work_orders_auto_deduct_parts()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  production_stages constant text[] := array[
    '備料中','零部件製作中','砂磨中','組裝中(一)','塗裝中',
    '組裝中(二)','塗裝中(二)','塗裝中(最終塗裝)','塗裝後製程(組配、編織)','包裝管理','待出貨'
  ];
  v_item record;
  v_material text;
  v_spec_key text;
  r record;
  v_target uuid;
begin
  if new.stage = old.stage then return new; end if;
  if not (new.stage = any(production_stages)) then return new; end if;
  if exists (select 1 from public.stock_movements where work_order_id = new.id) then
    return new;
  end if;

  select oi.order_id, oi.quantity, pv.series_id,
         coalesce(nullif(oi.wood_type, ''), pv.wood_type) as wood_type, pv.spec1
    into v_item
  from public.order_items oi
  join public.product_variants pv on pv.id = oi.variant_id
  where oi.id = new.order_item_id;
  if v_item is null then return new; end if;

  -- 材質代碼：name_zh 或 aliases 比對（煙燻白橡木→O）
  select m.code into v_material
  from public.materials m
  where m.name_zh = v_item.wood_type or v_item.wood_type = any(m.aliases)
  limit 1;

  -- 座墊互斥代碼：spec1 最後一段（布墊-F → F）
  v_spec_key := nullif(regexp_replace(coalesce(v_item.spec1, ''), '^.*-', ''), '');

  for r in
    select bl.*, p.name as part_name
    from public.bom_lines bl
    left join public.parts p on p.id = bl.part_id
    where bl.series_id = v_item.series_id
      and (bl.exclusive_key is null or bl.exclusive_key = v_spec_key)
  loop
    if r.line_type = 'fixed' then
      v_target := r.part_variant_id;
    else
      if v_material is null then
        raise exception 'BOM 扣料失敗：無法對應材質「%」，請於 materials 對照表補上', v_item.wood_type;
      end if;
      select pv2.id into v_target
      from public.part_variants pv2
      where pv2.part_id = r.part_id and pv2.material_code = v_material and pv2.deleted_at is null;
      if v_target is null then
        raise exception 'BOM 扣料失敗：零件「%」缺少材質 % 的變體，請先於零件庫存勾選建立', r.part_name, v_material;
      end if;
    end if;
    insert into public.stock_movements
      (part_id, part_variant_id, movement_type, quantity, movement_date, work_order_id, order_id, notes)
    select pvv.part_id, v_target, '領用', -(r.quantity * v_item.quantity), current_date, new.id, v_item.order_id,
           '生產工單開工自動扣帳'
    from public.part_variants pvv
    where pvv.id = v_target;
  end loop;

  return new;
end $function$;
