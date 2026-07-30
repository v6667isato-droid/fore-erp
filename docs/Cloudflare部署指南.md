# Cloudflare Workers 部署指南（與 Vercel 並行）

以 [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare) 把本專案部署到 Cloudflare Workers，
與 Vercel 並行運作，確認穩定後再切換正式網域，以節省 Vercel 未來開銷。

## 目前進度（2026-07-27）

- ✅ 已完成首次部署：**https://fore-erp.fore-furniture.workers.dev**（workers.dev subdomain：`fore-furniture`）
- ✅ 實測通過：登入頁渲染、`/api/products`（Supabase 資料）、`/employee-portal` 308 轉址、404 頁，皆無 console 錯誤
- ⬜ **Secrets 全部未設**（`npx wrangler secret list` 為空）→ AI 發票辨識、Gmail 匯入、
  寄信（薪資單／週報）、portal 登入在 Cloudflare 上暫時不能用
  - ⚠️ `CRON_SECRET` 未設前，`/api/cron/weekly-order-summary` 與 `/api/gmail-import`
    兩個端點是不設防的（程式邏輯為「有設 secret 才驗證」），建議優先補上
  - 設完 secrets 後需重新 `npm run cf:deploy` 生效
- ⬜ 以工坊帳號實際登入走一輪功能測試
- ⬜ Cron 仍由 Vercel 觸發（`wrangler.jsonc` 的 `triggers.crons` 保持註解中）
- ⬜ LINE webhook 仍指向 Vercel，切換正式網域時才改

## 已就緒的設定（repo 內）

| 檔案 | 用途 |
|---|---|
| `wrangler.jsonc` | Worker 設定（名稱 `fore-erp`、nodejs_compat、assets、cron 先註解） |
| `open-next.config.ts` | OpenNext 設定（無 ISR，維持預設） |
| `custom-worker.ts` | Worker 入口：包 OpenNext worker＋cron scheduled 處理 |
| `.dev.vars.example` | 本機 `cf:preview` 用的環境變數範本 |
| `package.json` | `cf:build` / `cf:preview` / `cf:deploy` / `cf:typegen` 指令 |

注意：adapter 要求 Next.js ≥16.2.11，已一併把 next 從 16.1.6 升到 16.2.12（Vercel 端共用）。

## 一次性設定

1. 登入 Cloudflare（免費方案即可起步）：

   ```bash
   npx wrangler login
   ```

2. 首次部署（會自動建立名為 `fore-erp` 的 Worker，取得 `*.workers.dev` 測試網址）：

   ```bash
   npm run cf:deploy
   ```

   `NEXT_PUBLIC_*` 變數在本機 `next build` 時就從 `.env.local` 內嵌，不需另外設定。

3. 設定「伺服器端」secrets（逐一執行，值同 Vercel 專案設定／`.env.local`）：

   ```bash
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   ```

   需要設定的完整清單（沒用到的功能可略過對應變數）：
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_LOGIN_CHANNEL_ID`、`LINE_CHANNEL_ID`、`LINE_RICH_MENU_CRAFTSMAN_ID`
   - `ANTHROPIC_API_KEY`、`GEMINI_API_KEY`（發票辨識／翻譯）
   - `GMAIL_CLIENT_ID`、`GMAIL_CLIENT_SECRET`、`GMAIL_REFRESH_TOKEN`、`GMAIL_REFRESH_TOKEN_2`
   - `RESEND_API_KEY`、`RESEND_FROM_EMAIL`、`MANAGER_EMAIL`
   - `CRON_SECRET`、`PORTAL_TOKEN_SECRET`、`WEBSITE_ORIGIN`
   - 選用覆寫：`INVOICE_AI_MODEL`、`INVOICE_GEMINI_MODEL`、`INVOICE_GEMINI_FALLBACK_MODEL`、`TRANSLATE_AI_MODEL`、`TRANSLATE_GEMINI_MODEL`、`TRANSLATE_GEMINI_FALLBACK_MODEL`、`GMAIL_INVOICE_QUERY`、`GMAIL_INVOICE_QUERY_2`

   也可以到 Cloudflare Dashboard → Workers → fore-erp → Settings → Variables and Secrets 批次貼上。

4. 設完 secrets 再部署一次讓設定生效：`npm run cf:deploy`。

## 日常部署

```bash
npm run cf:deploy
```

（先 `npm run build` 驗證再部署的習慣不變；`cf:deploy` 內含完整 next build。）

本機模擬 Workers 環境測試（需先把 `.dev.vars.example` 複製為 `.dev.vars` 填入 secrets）：

```bash
npm run cf:preview
```

## 並行期注意事項

- **Cron 只留一邊**：`wrangler.jsonc` 的 `triggers.crons` 目前是註解狀態，排程仍由 Vercel 觸發。
  若兩邊都開，每週訂單摘要會寄兩封、Gmail 匯入會跑兩次（匯入本身有依 message id 去重，但仍浪費額度）。
- **外部 webhook（LINE）仍指向 Vercel**：LINE Developers 後台的 Webhook URL 不動，等切換時再改。
- 測試用 `https://fore-erp.<你的帳號>.workers.dev` 完整走一輪：登入、訂單、發票審核（AI 辨識）、
  員工入口、列印頁。

## 正式切換（確認穩定後）

1. 解除 `wrangler.jsonc` 的 `triggers.crons` 註解，同時刪除 `vercel.json` 的 `crons`，重新部署兩邊。
2. 網域 DNS 改指到 Cloudflare：網域需加入 Cloudflare（或本來就在），
   Workers → fore-erp → Settings → Domains & Routes → 加 custom domain。
3. LINE Developers 後台 Webhook URL 改成新網域（網域不變則免改）。
4. `WEBSITE_ORIGIN` 等含網址的變數確認一致。
5. 觀察一~兩週沒問題後，Vercel 專案可降回 Hobby 或刪除。

## 費用與限制備忘

- Workers 免費方案：每天 10 萬次請求、每次 10ms CPU。本專案頁面多為靜態＋客端渲染，
  API 路由以等待外部 API（Supabase/Anthropic/Gmail）為主，CPU 佔用低，免費方案應可行。
- 若遇到 CPU 超限（AI 辨識路由最有可能），升級 Workers Paid（US$5/月，CPU 上限 5 分鐘），
  仍遠低於 Vercel Pro（US$20/月）。
- Vercel 的 `maxDuration = 60` 在 Workers 上不適用：Workers 對 I/O 等待沒有牆鐘限制，反而更寬鬆。
- Windows 上執行 OpenNext build 會出現「建議用 WSL」警告，實測 build 與本機 preview 皆正常。
