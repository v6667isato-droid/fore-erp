import type { WorkOrderStage } from "@/lib/work-order-stages";

/**
 * 編輯訂單存檔：品項依 id 沿用、只新增／刪除真正增減的列。
 *
 * 以前是「刪除全部品項與工單 → 整批重建」，每存一次檔品項／工單 id 就全換：
 * 工序歷程（work_order_stage_history／_logs）跟著工單被刪、已開工的扣帳
 * （stock_movements.work_order_id）變成 NULL 導致下次換工序重複扣料、
 * 發票／退貨品項的連結斷掉，掛在品項上的完工照片也會脫鉤。
 */

export interface ItemSavePlan<T> {
  /** 沿用的原品項：依原 id 更新內容與排序 */
  keep: { item: T; id: string; lineOrder: number }[];
  /** 新增的品項 */
  insert: { item: T; lineOrder: number }[];
  /** 已從訂單移除的原品項 id（工單隨 FK on delete cascade 一併刪除） */
  removeIds: string[];
}

/**
 * @param existingIds 資料庫中這張訂單目前的品項 id（新增訂單傳空陣列）
 * @param items 表單上要儲存的品項（順序即 line_order）；表單新增列的 id 是暫時 id，不會出現在 existingIds
 */
export function planOrderItemSave<T extends { id: string }>(
  existingIds: Iterable<string>,
  items: readonly T[],
): ItemSavePlan<T> {
  const remaining = new Set(existingIds);
  const keep: ItemSavePlan<T>["keep"] = [];
  const insert: ItemSavePlan<T>["insert"] = [];
  items.forEach((item, lineOrder) => {
    // 同一個原 id 只沿用一次，重複出現的視為新增
    if (remaining.delete(item.id)) {
      keep.push({ item, id: item.id, lineOrder });
    } else {
      insert.push({ item, lineOrder });
    }
  });
  return { keep, insert, removeIds: [...remaining] };
}

export interface WorkOrderFormFields {
  stage: WorkOrderStage;
  assignee_id: string | null;
  planned_end_date: string | null;
}

/**
 * 沿用品項的工單只寫入表單上改過的欄位：表單開著的期間工廠可能已在員工入口推進工序，
 * 沒動的欄位不回寫，才不會把較新的工序蓋回開表單當下的值。
 * @param initial 開表單時載入的工單欄位；undefined＝不知道原值，全部寫入
 */
export function workOrderPatch(
  initial: WorkOrderFormFields | undefined,
  next: WorkOrderFormFields,
): Partial<WorkOrderFormFields> {
  if (!initial) return { ...next };
  const patch: Partial<WorkOrderFormFields> = {};
  if (initial.stage !== next.stage) patch.stage = next.stage;
  if ((initial.assignee_id ?? null) !== (next.assignee_id ?? null)) {
    patch.assignee_id = next.assignee_id;
  }
  if ((initial.planned_end_date ?? null) !== (next.planned_end_date ?? null)) {
    patch.planned_end_date = next.planned_end_date;
  }
  return patch;
}
