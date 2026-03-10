# 軟刪除：資料庫設定說明

本專案使用「軟刪除」：刪除時只寫入 `deleted_at` 時間，不真正刪除資料，可還原。還原需由管理員在後台確認。

## 一、在 Supabase 建立欄位

### 方法 A：用 SQL Editor（建議）

1. 登入 [Supabase Dashboard](https://supabase.com/dashboard)，選擇你的專案。
2. 左側點 **SQL Editor**。
3. 新增查詢，貼上以下 SQL 後按 **Run**：

```sql
-- 軟刪除：各表新增 deleted_at
ALTER TABLE user_feedback   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE customers       ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE vendors         ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE employees       ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE product_series  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE purchases       ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
```

4. 若沒有某張表（例如尚未建立），可先刪掉該行再執行，或只執行你已有之表。

### 方法 B：用本專案 migration 檔

專案內已有 migration 檔：

- `supabase/migrations/20250311000000_soft_delete_deleted_at.sql`

若你使用 Supabase CLI 且已連結專案，可在專案根目錄執行：

```bash
supabase db push
```

或手動把該檔內容複製到 SQL Editor 執行。

## 二、欄位說明

| 欄位       | 型別        | 說明 |
|------------|-------------|------|
| `deleted_at` | `timestamptz` | 若為 `NULL` 表示未刪除；有值表示該時間點被軟刪除。 |

- 一般查詢時加上條件：`WHERE deleted_at IS NULL`，只列出未刪除資料。
- 還原時將該筆的 `deleted_at` 更新為 `NULL` 即可。

## 三、已支援軟刪除的模組

- **使用回饋**：刪除 → 移至已刪除；「顯示已刪除項目」可列出並由管理員確認後還原。
- 其餘模組（訂單、客戶、廠商、員工、產品、採購等）將陸續改為軟刪除並提供還原。

## 四、注意事項

- 若某張表尚未有 `deleted_at`，該表的刪除仍為「硬刪除」直到你補上欄位並改程式。
- 還原功能僅在後台提供，且需管理員確認後才執行還原（寫入 `deleted_at = NULL`）。
