import { Suspense } from "react";
import DashboardShell from "@/components/dashboard-shell";

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background flex items-center justify-center text-muted-foreground">載入中…</div>}>
      <DashboardShell />
    </Suspense>
  );
}
