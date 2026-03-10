# 每週訂單統整 Email 設定說明

系統會於每週一早上 9 點（台灣時間）自動將「過去一週」的訂單彙整成一份報表，寄到管理者的 email。

---

## 一、功能說明

- **觸發**：Vercel Cron 每週一 09:00（台灣時間）呼叫 API。
- **內容**：過去 7 天內有「下單日」的訂單，表格含：訂單編號、客戶、下單日、預計交貨、狀態、來源（通路/內部）、金額。
- **收件人**：由環境變數 `MANAGER_EMAIL` 指定。

---

## 二、環境變數（Vercel 專案設定）

在 Vercel 專案 **Settings → Environment Variables** 新增：

| 變數名稱 | 必填 | 說明 |
|----------|------|------|
| `MANAGER_EMAIL` | ✅ | 收信的管理者 email（每週報表寄到這裡） |
| `RESEND_API_KEY` | ✅ | Resend 後台取得的 API Key，用於寄信 |
| `CRON_SECRET` | 建議 | 自訂一組密碼，僅 Cron 呼叫時帶此值驗證，避免被隨意觸發 |
| `RESEND_FROM_EMAIL` | 選填 | 寄件人顯示，例：`Fore ERP <notify@你的網域.com>`，未設則用 Resend 預設 |

---

## 三、取得 Resend API Key

1. 前往 [resend.com](https://resend.com) 註冊／登入。
2. 在 Dashboard 的 **API Keys** 新增一組 Key，複製後貼到 Vercel 的 `RESEND_API_KEY`。
3. 免費方案即可用來寄每週一封報表；若要用自己的網域當寄件人，需在 Resend 驗證網域後再設 `RESEND_FROM_EMAIL`。

---

## 四、CRON_SECRET 建議

- 自己產生一組隨機字串（例如：`openssl rand -hex 24` 或密碼產生器）。
- 只在 Vercel 環境變數裡設定，不要寫進程式碼或提交到 Git。
- 設定後，只有帶 `Authorization: Bearer <CRON_SECRET>` 的請求能成功觸發寄信。

---

## 五、手動測試（部署後）

把 `你的CRON_SECRET`、`你的網域` 換成實際值後執行：

```bash
curl -H "Authorization: Bearer 你的CRON_SECRET" "https://你的網域/api/cron/weekly-order-summary"
```

- 成功：回傳 `{"ok":true,"messageId":"..."}`，且 `MANAGER_EMAIL` 會收到一封當週報表。
- 失敗：依回傳訊息檢查（例如 401 為密碼錯誤、500 可能為缺 `MANAGER_EMAIL` 或 `RESEND_API_KEY`）。

---

## 六、相關檔案

- API：`src/app/api/cron/weekly-order-summary/route.ts`
- 排程設定：`vercel.json`（`crons` 區塊）
- 簡要說明：專案根目錄 `README.md` 的「每週訂單統整 Email」一節

---

*最後更新：依本專案實作時一併建立。*
