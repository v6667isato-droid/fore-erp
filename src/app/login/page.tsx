"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getPathAfterLogin } from "@/lib/post-login-redirect";
import {
  getSupabaseSession,
  isAuthSessionMissingError,
  isLikelySupabaseNetworkError,
  isSupabaseConfigured,
  supabase,
  SUPABASE_CONFIG_HELP,
} from "@/lib/supabase";
import { cn } from "@/lib/utils";

const inputFocusClass =
  "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-0";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!isSupabaseConfigured) {
        if (!cancelled) {
          setConnectionError(SUPABASE_CONFIG_HELP);
          setLoading(false);
        }
        return;
      }

      try {
        const {
          data: { session },
          error,
        } = await getSupabaseSession();
        if (cancelled) return;
        if (error && !isAuthSessionMissingError(error)) throw error;
        if (session?.user) {
          const path = await getPathAfterLogin(session.user.id);
          router.replace(path);
        } else {
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[fore-erp] employee login init:", err);
        setConnectionError(
          isLikelySupabaseNetworkError(err)
            ? "無法連線至 Supabase。請檢查網路、VPN／防火牆，以及 .env.local 中的 URL 是否正確。"
            : err instanceof Error
              ? err.message
              : "無法檢查登入狀態"
        );
        setLoading(false);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!email.trim() || !password) {
      setSubmitError("請輸入工坊信箱與通行密碼。");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setSubmitError("帳號或密碼錯誤，請聯絡管理員。");
        return;
      }
      const uid = data.user?.id;
      if (!uid) {
        router.push("/employee/dashboard");
        return;
      }
      const path = await getPathAfterLogin(uid);
      router.push(path);
    } catch (err) {
      console.error("[fore-erp] employee signIn:", err);
      setSubmitError(
        isLikelySupabaseNetworkError(err)
          ? "無法連線至伺服器，請檢查網路與 Supabase 設定。"
          : "登入失敗，請稍後再試或聯絡管理員。"
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">載入中…</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background px-4 py-10 flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-xl">
        <div className="mb-8 text-center">
          <p className="font-serif text-2xl font-semibold tracking-wide text-foreground md:text-[1.65rem]">
            Føre Furniture
          </p>
          <p className="mt-2 text-sm font-medium tracking-[0.12em] text-primary">
            員工專屬入口
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            請使用工坊配發之帳號登入。驗證由 Supabase Auth 處理。
          </p>
        </div>

        {connectionError && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-left text-xs leading-relaxed text-red-800"
          >
            {connectionError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="employee-email" className="text-xs font-medium text-primary">
              工坊信箱 (Email)
            </label>
            <input
              id="employee-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (submitError) setSubmitError(null);
              }}
              autoComplete="email"
              placeholder="name@workshop.tw"
              className={cn(
                "h-11 w-full rounded-xl border border-input bg-card px-4 text-sm text-foreground",
                "placeholder:text-muted-foreground",
                inputFocusClass
              )}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="employee-password" className="text-xs font-medium text-primary">
              通行密碼 (Password)
            </label>
            <input
              id="employee-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (submitError) setSubmitError(null);
              }}
              autoComplete="current-password"
              placeholder="請輸入密碼"
              className={cn(
                "h-11 w-full rounded-xl border border-input bg-card px-4 text-sm text-foreground",
                "placeholder:text-muted-foreground",
                inputFocusClass
              )}
            />
          </div>

          {submitError && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-center text-sm text-red-800"
            >
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !isSupabaseConfigured}
            className={cn(
              "h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground",
              "transition-colors hover:bg-primary/90 active:bg-primary/80",
              "disabled:pointer-events-none disabled:opacity-55"
            )}
          >
            {submitting ? "驗證中…" : "登入"}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
          此入口僅供 Føre 工坊同仁使用。如有問題請聯繫管理者。
        </p>
      </div>
    </div>
  );
}
