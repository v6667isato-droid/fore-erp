# 我的投資：個人投資資料庫設定

「我的投資」頁面寫在 fore-erp 裡（前台不變、選單多一項），但**資料存在另一個只屬於擁有者的 Supabase 專案**，
不在公司資料庫：

- 公司資料庫、公司金鑰（service role key）、公司備份裡都沒有個人投資資料
- 選單只有 `NEXT_PUBLIC_INVEST_OWNER_USER_ID` 指定的 fore-erp 帳號看得到，其他 admin 也看不到
- 打開頁面後還要用「投資帳號」再登入一次（與 ERP 帳號分開）；資料表的 RLS 只允許本人讀寫

> ⚠️ `migrations/` 裡的 SQL 只能在個人專案執行，**不要**貼到 fore-erp 公司資料庫。

## 一次性設定

### 1. 選一個個人 Supabase 專案

可以用既有的個人專案（目前放在 `kids-finance`），或到 [supabase.com](https://supabase.com) 另開新專案。
所有表、函式、索引都以 `invest_` 開頭，放進既有專案不會和原本的表撞名。
（免費方案最多同時 2 個專案；公司 ERP 已佔一個。）

### 2. 建立資料表

專案的 **SQL Editor** → 新增查詢 → 貼上 `migrations/20261022100000_invest_init.sql` 全部內容 → **Run**。

### 3. 投資帳號

「我的投資」頁面用這個專案的登入帳號（Authentication → Users）。專案裡已經有自己的帳號就直接沿用；
沒有的話 **Add user → Create new user**，輸入 email 與密碼並勾選 **Auto Confirm User**。

每筆資料都綁定 owner_id，RLS 只讓本人讀寫，專案裡就算有其他帳號也看不到。
如果這個專案不需要開放註冊，建議到 **Authentication → Sign In / Providers** 關閉 **Allow new users to sign up**。

### 4. 設定 fore-erp 環境變數

| 變數 | 值 |
| --- | --- |
| `NEXT_PUBLIC_INVEST_SUPABASE_URL` | 個人專案的 Project URL（Project Settings → Data API） |
| `NEXT_PUBLIC_INVEST_SUPABASE_ANON_KEY` | 個人專案的 anon（或 publishable）key（Project Settings → API Keys） |
| `NEXT_PUBLIC_INVEST_OWNER_USER_ID` | 你在 **fore-erp 公司 Supabase** 的帳號 UID（公司專案 → Authentication → Users → 找到自己的 email → 複製 UID） |

- anon key 本來就是公開金鑰，資料靠「登入＋RLS」保護；**個人專案的 service role key 不要放進 fore-erp**。
- `NEXT_PUBLIC_*` 變數在 build 時內嵌：Cloudflare 部署寫進 `.env.local` 後執行 `npm run cf:deploy`；
  Vercel 則在 Project Settings → Environment Variables 新增後重新部署。
- 三個變數缺任何一個，選單就不會出現「我的投資」。

## 使用流程

1. 選單「我的投資」→ 用投資帳號登入
2. **新增帳戶**：每個券商一個（台股、美股分開）
3. **交易紀錄 → 匯入對帳單**：選帳戶、選 Excel／CSV。已匯入過的交易自動略過，之後不定時匯入新的對帳單即可
4. **拆股／配股**：對帳單上沒有，要手動補登（例如 0050 在 2025 年 6 月一拆四）。持股頁出現「賣出股數比當時持股多」的警告時，就是漏記了這類事件
5. **股利**：輸入除息日與每股配息，系統依交易紀錄算出除息日前一天的持股、應收金額與二代健保補充保費；入帳後按「已入帳」
6. **持股**：手動填現價後會顯示市值、未實現損益與報酬率

## 備註

- 免費方案的專案一段時間沒有使用會被暫停，到 Supabase 後台按 **Restore** 即可，資料不會遺失。
- 對帳單格式目前依「成交日、商品、買賣、數量、成交價、價金、手續費、交易稅、應付金額、應收金額、委託單號、幣別」等標題對應欄位；
  換券商或美股對帳單格式不同時，調整 `src/lib/invest-statement-import.ts` 的 `HEADER_ALIASES`。
