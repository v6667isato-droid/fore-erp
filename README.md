This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 每週訂單統整 Email

系統可於每週一固定時間將「過去一週訂單」彙整寄到管理者信箱。

- **排程**：Vercel Cron 每週一 09:00（台灣時間），呼叫 `/api/cron/weekly-order-summary`。
- **環境變數**（在 Vercel 專案設定）：
  - `MANAGER_EMAIL`：收信的管理者 email（必填）。
  - `RESEND_API_KEY`： [Resend](https://resend.com) API Key（必填，用於寄信）。
  - `CRON_SECRET`：自訂密碼，供 Cron 驗證用（建議設定，未設定則不驗證）。
  - `RESEND_FROM_EMAIL`（選填）：寄件人顯示，例如 `Fore ERP <notify@yourdomain.com>`，未設則使用 Resend 預設。
- 手動測試：`curl -H "Authorization: Bearer 你的CRON_SECRET" https://你的網域/api/cron/weekly-order-summary`
