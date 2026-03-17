import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
      <h1 className="text-2xl font-semibold text-foreground mb-2">找不到頁面</h1>
      <p className="text-muted-foreground mb-6">
        您前往的網址可能已變更或不存在。
      </p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        返回首頁
      </Link>
    </div>
  );
}
