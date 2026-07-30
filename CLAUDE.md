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
