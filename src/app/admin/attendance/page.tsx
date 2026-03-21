"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  isAuthSessionMissingError,
  isSupabaseConfigured,
  supabase,
  SUPABASE_CONFIG_HELP,
} from "@/lib/supabase";
import { AttendanceImporterPanel } from "@/components/attendance-importer-panel";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AdminAttendancePage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!isSupabaseConfigured) {
        if (!cancelled) {
          setAllowed(false);
          setChecked(true);
        }
        return;
      }

      try {
        const {
          data: { session },
          error: sessionErr,
        } = await supabase.auth.getSession();
        if (cancelled) return;
        if (sessionErr && !isAuthSessionMissingError(sessionErr)) throw sessionErr;

        const user = session?.user ?? null;
        if (!user) {
          router.replace("/login");
          return;
        }

        const { data: profile } = await supabase
          .from("user_profiles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (cancelled) return;

        const raw = ((profile?.role as string) ?? "").trim().toLowerCase();
        if (raw !== "admin") {
          router.replace("/?page=dashboard");
          return;
        }

        setAllowed(true);
        setChecked(true);
      } catch (e) {
        console.error("[admin/attendance] auth:", e);
        if (!cancelled) {
          router.replace("/login");
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!checked) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center text-sm text-muted-foreground">
        檢查權限中…
      </div>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-6">
        <div className="max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">{SUPABASE_CONFIG_HELP}</p>
          <Link
            href="/"
            className={cn(buttonVariants({ variant: "outline" }), "inline-flex w-full justify-center")}
          >
            返回 ERP
          </Link>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return null;
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/?page=leave_approvals"
              className="text-sm font-medium text-primary hover:underline"
            >
              ← 返回批准作業
            </Link>
            <span className="text-muted-foreground">|</span>
            <h1 className="truncate font-serif text-lg font-semibold tracking-tight text-foreground">
              出勤戰情分析室
            </h1>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
        <AttendanceImporterPanel />
      </div>
    </div>
  );
}
