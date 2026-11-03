-- 採購物料主檔改名／改類別／改規格／改單位時，同步更新已對應該物料（material_id）的採購明細。
-- 原因：purchases 的 item_name／item_category／spec／spec2／unit 是新增明細當下自主檔複製的快照，
-- 主檔改了（例：「工膜」→「PE膠膜」）採購明細、廠商總覽、成本統計仍顯示舊字。
-- 採購明細編輯畫面本來就標示「品名／類別／規格／單位以主檔為準」，故由 DB trigger 統一帶過去，
-- 涵蓋「編輯物料」與「管理物料主類別」改副類別名稱等所有改主檔的路徑。
-- 只帶「這次真的有變」的欄位：只改品名就只同步品名，不會順便覆蓋明細上的類別／單位。
-- 未對應主檔（material_id IS NULL）的手動明細不動。

CREATE OR REPLACE FUNCTION public.sync_purchases_from_procurement_material ()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  name_changed boolean := NEW.name IS DISTINCT FROM OLD.name;
  category_changed boolean := NEW.item_category IS DISTINCT FROM OLD.item_category;
  spec_changed boolean := NEW.spec IS DISTINCT FROM OLD.spec OR NEW.spec2 IS DISTINCT FROM OLD.spec2;
  unit_changed boolean := NEW.unit IS DISTINCT FROM OLD.unit;
  spec_a text := trim(coalesce(NEW.spec, ''));
  spec_b text := trim(coalesce(NEW.spec2, ''));
  -- 與前端 purchaseSpecFromMaterialParts 相同：規格 + 規格2 以「 / 」連接
  merged_spec text := CASE
    WHEN spec_a <> '' AND spec_b <> '' THEN spec_a || ' / ' || spec_b
    ELSE nullif(spec_a || spec_b, '')
  END;
BEGIN
  IF NOT (name_changed OR category_changed OR spec_changed OR unit_changed) THEN
    RETURN NEW;
  END IF;

  UPDATE public.purchases p
  SET
    item_name = CASE WHEN name_changed THEN trim(NEW.name) ELSE p.item_name END,
    item_category = CASE WHEN category_changed THEN nullif(trim(coalesce(NEW.item_category, '')), '') ELSE p.item_category END,
    spec = CASE WHEN spec_changed THEN merged_spec ELSE p.spec END,
    spec2 = CASE WHEN spec_changed THEN nullif(spec_b, '') ELSE p.spec2 END,
    unit = CASE WHEN unit_changed THEN nullif(trim(coalesce(NEW.unit, '')), '') ELSE p.unit END
  WHERE p.material_id = NEW.id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_purchases_from_procurement_material () IS
  '採購物料主檔更新後，把有變動的品名／類別／規格／單位同步到 material_id 對應的採購明細';

-- 只給 trigger 用，不開放直接呼叫
REVOKE EXECUTE ON FUNCTION public.sync_purchases_from_procurement_material () FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_purchases_from_procurement_material ON public.procurement_materials;
CREATE TRIGGER sync_purchases_from_procurement_material
  AFTER UPDATE OF name, item_category, spec, spec2, unit ON public.procurement_materials
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_purchases_from_procurement_material ();

-- 既有資料：補同步「品名」（主檔先前改過名但明細沒跟著改的；2026-11-03 正式庫試算 5 筆：
-- 工膜→PE膠膜、銅遊→銅油、展覽費用→參展費）。類別／規格／單位的舊差異不在此一併覆蓋。
UPDATE public.purchases p
SET item_name = m.name
FROM public.procurement_materials m
WHERE m.id = p.material_id
  AND p.item_name IS DISTINCT FROM m.name;
