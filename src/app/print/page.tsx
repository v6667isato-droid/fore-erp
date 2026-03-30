"use client";

import Link from "next/link";

export default function PrintIndexPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
      <h1 className="text-xl font-semibold text-foreground mb-2">列印頁面</h1>
      <p className="text-muted-foreground mb-6 max-w-sm">
        請從「報價管理」或「訂單管理」的列表中，點選該筆訂單的「報價列印」或「訂單列印」按鈕，即可開啟對應的列印頁面。
      </p>
      <Link
        href="/print/chair-production"
        className="mb-4 inline-flex text-sm font-medium text-primary hover:underline"
      >
        椅子生產管理表（CH03／CH03A・未出貨・A4 直式）
      </Link>
      <Link
        href="/"
        className="text-sm font-medium text-primary hover:underline"
      >
        ← 返回首頁
      </Link>
    </div>
  );
}
