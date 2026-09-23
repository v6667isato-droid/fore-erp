# CLAUDE.md

## RWD／手機瀏覽規則（必守）

本系統經常在手機上使用，所有 UI 變更寫完時必須符合以下規則，以 375px 寬（iPhone SE）為最窄基準：

- **多欄表單網格一律加響應式前綴**：寫 `grid grid-cols-1 sm:grid-cols-2`（三欄用 `grid-cols-1 sm:grid-cols-2 md:grid-cols-3`），不要寫死 `grid-cols-2` 以上而沒有小螢幕 fallback。
  - 例外：內容本來就很短的成對欄位（起訖日期、數量＋單位等）可維持 `grid-cols-2`。
- **表格**外層包 `overflow-x-auto`，不要讓表格撐破頁面寬度。
- **按鈕列／篩選列**用 `flex flex-wrap gap-2`，不要並排固定寬度元素。
- **避免固定 px 寬度**（如 `w-[400px]`）出現在手機會看到的區塊，改用 `w-full` ＋ `max-w-*`。
- **Dialog** 自訂 `max-w-*` 時確認手機下仍有左右邊距（shadcn 預設有處理，覆寫時注意）。
- 改動版面後自我檢查：在 375px 寬下，每個欄位是否放得下 label＋輸入內容而不擠壓。

## 數字輸入欄位（必守）

員工反應數字欄位預設顯示 0 時必須先刪掉 0 才能輸入，所有新增／修改的數字欄位一律照以下規則：

- **一律使用 `NumericInput`**（`@/components/ui/numeric-input`），不要直接寫 `<input type="number">`，也不要寫 `Number(e.target.value) || 0` 這種清空後馬上補回 0 的寫法。
- **0 或空值顯示為空白**（placeholder 顯示淡灰色 0），使用者點進去可直接輸入，不必先刪 0。元件已內建，不要傳 `value={x || ""}` 自己處理。
- **只能輸入數字**：元件會擋掉文字、`e`、`+`、`-` 等字元，貼上時自動去掉千分位、文字並把全形數字轉半形。預設只收整數；金額以外需要小數（如尺寸）時加 `allowDecimal`。
- 手機會自動跳數字鍵盤（元件已設 `inputMode`），不需另外處理。
- 清空欄位時 `onValueChange` 會收到 `null`，由呼叫端決定存成什麼：
  - 金額類：`v ?? 0`（或可為空的欄位存 `null`）。
  - 必填且有最小值（如數量）：`Math.max(1, v ?? 1)`，state 不要存 0／null，避免按 Enter 直接送出時被當成無效資料。欄位在輸入中仍會維持空白，失焦後才顯示回預設值。
- 樣式已內建（`h-9`、圓角、focus ring、read-only 底色），只需用 `className` 補寬度等差異。
