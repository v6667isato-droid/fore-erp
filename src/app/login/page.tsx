"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 若已經登入，直接導向首頁
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled) {
        if (user) {
          router.replace("/");
        } else {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("請輸入 Email 與密碼");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message || "登入失敗，請再試一次");
      return;
    }
    toast.success("登入成功");
    router.replace("/");
  }

  if (loading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="rounded-xl border border-border bg-card px-6 py-4 text-sm text-muted-foreground">
          準備登入畫面中…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card px-6 py-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="font-serif text-2xl font-semibold text-foreground">
            Fore ERP 登入
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            內部系統 · 請使用工坊帳號登入
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="login-email"
              className="text-xs text-muted-foreground"
            >
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="you@workshop.tw"
              autoComplete="email"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="login-password"
              className="text-xs text-muted-foreground"
            >
              密碼
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="請輸入密碼"
              autoComplete="current-password"
            />
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              className="w-full"
              disabled={submitting}
            >
              {submitting ? "登入中…" : "登入"}
            </Button>
          </div>

          <p className="mt-2 text-xs text-muted-foreground text-center">
            此系統僅供 Fore 工坊內部使用。如有登入問題，請聯繫管理者。
          </p>
        </form>
      </div>
    </div>
  );
}

