# RLS Policy 規劃：channels / customers / orders / order_items / work_orders

> 2026-07-18 起草。目標：為目前 5 張 RLS 未啟用的表補上 Row Level Security，
> 且不弄壞既有的三種存取路徑（ERP、通路下單 /portal、API routes）。

## 現況與存取矩陣

系統有三種身分在打 Supabase：

| 身分 | 說明 | RLS 影響 |
| --- | --- | --- |
| `authenticated` | ERP 後台（admin/manager/staff 經 Supabase Auth 登入）、`/channels/[id]/orders`（有 `useRequireAuth`）、員工儀表板、列印頁 | 受 policy 管 |
| `anon` | **`/portal` 通路下單**：登入是自製簽章 token（`portal-token.ts`），不是 Supabase Auth，所以瀏覽器直接用 anon key 讀寫資料庫 | 受 policy 管（目前 RLS 關閉 = 全開） |
| `service_role` | API routes（`/api/portal-login`、`/api/portal/planned-end-dates`、cron、LINE webhook…） | **不受 RLS 影響**，永遠可用 |

五張表被誰用（anon 欄位是關鍵）：

| 表 | authenticated（ERP） | anon（/portal） | service_role |
| --- | --- | --- | --- |
| `channels` | 讀寫（通路管理、產品定價） | 無（登入走 API） | portal-login 讀 |
| `customers` | 讀寫（CRM、開單） | 僅間接：訂單卡 embed `customers(name, alias)` | portal-login 讀 |
| `orders` | 讀寫 | **讀 + 新增 + 更新**（下單、改自己的報價單） | 讀（cron、planned-end-dates） |
| `order_items` | 讀寫 | **讀 + 新增 + 刪除**（編輯訂單時整批重建） | – |
| `work_orders` | 讀寫 | **讀 + 新增 + 刪除**（下單時建工單、編輯時重建） | 讀 |

### 額外發現（提高急迫性）

- `channels` 表有 `portal_code`、`portal_password`（**明碼密碼**）欄位。
  RLS 關閉 + anon key 在前端 bundle 內是公開的 = **任何人都能撈到所有通路的
  portal 帳密，進而登入任何通路的下單入口**。這是五張表中最急的一張。
- `work_orders` 已存在一條 policy `work_orders_update_own_assignee`
  （員工只能更新自己被指派的工單），但因 RLS 未啟用而處於休眠狀態。

## 分兩階段執行

### Phase 1 — 立即可做：`channels`、`customers`

這兩張表 anon 幾乎不用（見上表），比照全庫現有慣例
（`<table>_authenticated_all`）補 policy 即可：

```sql
-- channels：堵住 portal 帳密外洩（最優先）
alter table public.channels enable row level security;
create policy channels_authenticated_all on public.channels
  for all to authenticated using (true) with check (true);

-- customers：客戶個資（電話、地址、LINE、統編）
alter table public.customers enable row level security;
create policy customers_authenticated_all on public.customers
  for all to authenticated using (true) with check (true);
```

- service role 的 API（portal-login 等）不受影響。
- **已知小副作用**：`/portal` 訂單總覽卡片經由 `orders → customers(name, alias)`
  的 embed 讀客戶名稱，啟用後該 embed 對 anon 回 `null`，卡片上客戶名會變空白
  （不會報錯；與現況 `employees` embed 對 anon 的行為相同）。
  緩解：portal 登入回應本來就帶 `customer_name`，前端用它 fallback 即可（一行小改）。

Phase 1 驗證清單：

1. ERP：客戶資料頁 CRUD、通路管理頁 CRUD、開單時客戶下拉正常。
2. `/portal`：登入正常（走 service role）、下單流程不動（orders 等尚未開 RLS）。
3. 匿名驗證：用 anon key 直接 `GET /rest/v1/channels?select=portal_password`
   應回空陣列。

### Phase 2 — 需配套：`orders`、`order_items`、`work_orders`

**不能直接開**：/portal 以 anon 身分直接讀寫這三張表，
直接啟用 + 只給 authenticated policy 會讓通路下單整個壞掉。
而 anon 的請求沒有任何可驗證身分（簽章 token 只存在 localStorage，資料庫看不到），
所以也寫不出「只能看自己訂單」的 anon policy。兩條路：

**選項 A（建議）：/portal 改走 API routes**

把 `src/app/portal/page.tsx` 內約 15 處 `supabase.from(...)` 直接讀寫，
搬進 API routes（service role + `verifyPortalSession()` 驗 token）。
`/api/portal-login`、`/api/portal/planned-end-dates` 已是這個模式，等於補齊：

- `GET  /api/portal/orders`（列出自己 customer_id 的訂單）
- `GET  /api/portal/orders/[id]`（訂單明細，含 items）
- `POST /api/portal/orders`（下單：orders + order_items + work_orders）
- `PUT  /api/portal/orders/[id]`（編輯報價單：重建 items/工單）
- `DELETE /api/portal/orders/[id]`（如有取消功能）

每個 route 都必須用 token 中的 `customer_id` 做 server 端過濾/檢查，
不能信前端傳來的 customer_id。改完後執行：

```sql
alter table public.orders enable row level security;
create policy orders_authenticated_all on public.orders
  for all to authenticated using (true) with check (true);

alter table public.order_items enable row level security;
create policy order_items_authenticated_all on public.order_items
  for all to authenticated using (true) with check (true);

alter table public.work_orders enable row level security;
create policy work_orders_authenticated_all on public.work_orders
  for all to authenticated using (true) with check (true);
```

註：`work_orders` 加了 `authenticated_all` 後，既有的
`work_orders_update_own_assignee` 會變冗餘（policy 之間是 OR）。
若希望「員工只能動自己被指派的工單、admin/manager 才全開」，
可以不加 `authenticated_all` 的 UPDATE，改成：

```sql
-- 較嚴格的替代：SELECT 全員、寫入僅 admin/manager，UPDATE 另靠既有 assignee policy
create policy work_orders_select_authenticated on public.work_orders
  for select to authenticated using (true);
create policy work_orders_write_admin_manager on public.work_orders
  for all to authenticated
  using (exists (select 1 from public.user_profiles up
                 where up.user_id = auth.uid()
                   and lower(trim(coalesce(up.role,''))) in ('admin','manager')))
  with check (exists (select 1 from public.user_profiles up
                      where up.user_id = auth.uid()
                        and lower(trim(coalesce(up.role,''))) in ('admin','manager')));
-- 員工更新自己工單：沿用既有 work_orders_update_own_assignee
```

**選項 B（不建議，但列出）：資料庫內驗簽章 token**

portal 的 supabase client 加自訂 header 帶 token，用 pgcrypto 在 SQL function
裡驗 HMAC 並取出 customer_id，policy 寫
`customer_id = portal_customer_id()`。優點是前端幾乎不用改；
缺點是 HMAC secret 要進資料庫設定、base64url/驗簽 SQL 複雜、
之後每次改 token 格式都要同步改 DB，維護成本高。

Phase 2 驗證清單：

1. `/portal`：登入 → 下單 → 編輯報價單 → 看訂單清單/明細，全流程過。
2. ERP：訂單管理、生產管理（工單拖拉/指派）、銷售統計、成本統計正常。
3. 員工儀表板：更新自己工單 stage 正常。
4. 匿名驗證：anon key 直接 `GET /rest/v1/orders` 應回空陣列。

## 順帶建議（本規劃範圍外）

- `user_profiles` 目前是 `authenticated_all`：任何登入者（含 staff）理論上可改
  自己的 `role` 成 admin。建議日後改成「本人只能讀自己、僅 admin 可寫」。
- `channels.portal_password` 是明碼。長期建議改存 hash（bcrypt），
  portal-login 改用 `crypt()` 比對。
