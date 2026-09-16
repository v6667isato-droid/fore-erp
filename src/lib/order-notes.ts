/**
 * 訂單／明細備註的顯示區塊。
 * 生產管理（work-orders-page）與訂單總覽（orders-overview-page）共用，
 * 讓兩邊的來源欄位與標籤文字一致。
 */
export type OrderNoteSection = { label: string; text: string };

/** 空白（含只有空白字元）的來源不列入；回傳空陣列代表「沒有備註」，呼叫端據此決定是否顯示展開鈕。 */
export function orderNoteSections(input: {
  /** order_items.custom_notes —— 開單時的「客製化備註」 */
  itemNotes?: string | null;
  /** order_items.custom_description —— 開單時的「詳細描述 / 備註」 */
  itemDescription?: string | null;
  /** orders.internal_notes —— 訂單主檔的「訂單備註」 */
  orderNotes?: string | null;
}): OrderNoteSection[] {
  return [
    { label: "客製化備註", text: (input.itemNotes ?? "").trim() },
    { label: "詳細描述", text: (input.itemDescription ?? "").trim() },
    { label: "訂單備註", text: (input.orderNotes ?? "").trim() },
  ].filter((section) => section.text !== "");
}
