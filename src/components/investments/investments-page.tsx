"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { LogOut, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { investDb, isInvestConfigured } from "@/lib/invest-client";
import { computePortfolio } from "@/lib/invest-portfolio";
import type {
  InvestAccount,
  InvestCorporateAction,
  InvestDividend,
  InvestQuote,
  InvestTrade,
} from "@/lib/invest-types";
import { AccountFormDialog } from "@/components/investments/account-form-dialog";
import { CorporateActionsTab } from "@/components/investments/corporate-actions-tab";
import { DividendsTab } from "@/components/investments/dividends-tab";
import { HoldingsTab } from "@/components/investments/holdings-tab";
import { TradesTab } from "@/components/investments/trades-tab";
import { inputClass, labelClass } from "@/components/investments/invest-ui";

export type InvestData = {
  accounts: InvestAccount[];
  trades: InvestTrade[];
  actions: InvestCorporateAction[];
  dividends: InvestDividend[];
  quotes: InvestQuote[];
};

type InvestTab = "holdings" | "trades" | "dividends" | "actions";

const TABS: { id: InvestTab; label: string }[] = [
  { id: "holdings", label: "持股" },
  { id: "trades", label: "交易紀錄" },
  { id: "dividends", label: "股利" },
  { id: "actions", label: "拆股／配股" },
];

/** Supabase 預設單次最多回 1000 筆；分頁抓齊全部資料 */
async function fetchAll<T>(table: string, orderBy: string[]): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    let q = investDb.from(table).select("*");
    for (const col of orderBy) q = q.order(col);
    const { data, error } = await q.range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

/** numeric 欄位統一轉成 number（避免大數值以字串回傳時計算出錯） */
function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(v: unknown): number | null {
  return v == null ? null : toNum(v);
}

async function loadInvestData(): Promise<InvestData> {
  const [accounts, trades, actions, dividends, quotes] = await Promise.all([
    fetchAll<InvestAccount>("accounts", ["created_at", "id"]),
    fetchAll<InvestTrade>("trades", ["trade_date", "id"]),
    fetchAll<InvestCorporateAction>("corporate_actions", ["action_date", "id"]),
    fetchAll<InvestDividend>("dividends", ["ex_date", "id"]),
    fetchAll<InvestQuote>("quotes", ["symbol"]),
  ]);
  return {
    accounts,
    trades: trades.map((t) => ({
      ...t,
      quantity: toNum(t.quantity),
      price: toNum(t.price),
      amount: toNum(t.amount),
      fee: toNum(t.fee),
      tax: toNum(t.tax),
      net_amount: toNum(t.net_amount),
    })),
    actions: actions.map((a) => ({ ...a, ratio: toNumOrNull(a.ratio), quantity: toNumOrNull(a.quantity) })),
    dividends: dividends.map((d) => ({
      ...d,
      cash_per_share: toNum(d.cash_per_share),
      shares: toNum(d.shares),
      gross_amount: toNum(d.gross_amount),
      nhi_premium: toNum(d.nhi_premium),
      withholding_tax: toNum(d.withholding_tax),
      fee: toNum(d.fee),
      net_amount: toNum(d.net_amount),
    })),
    quotes: quotes.map((q) => ({ ...q, price: toNum(q.price) })),
  };
}

/** 我的投資：只有擁有者看得到，資料存在獨立的 Supabase 專案，需另外登入 */
export function InvestmentsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(isInvestConfigured);

  useEffect(() => {
    if (!isInvestConfigured) return;
    let cancelled = false;
    void investDb.auth.getSession().then(async ({ data, error }) => {
      if (error) await investDb.auth.signOut({ scope: "local" });
      if (cancelled) return;
      setSession(error ? null : data.session);
      setChecking(false);
    });
    const { data: sub } = investDb.auth.onAuthStateChange((_event, s) => {
      if (!cancelled) setSession(s);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!isInvestConfigured) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        尚未設定個人投資資料庫（NEXT_PUBLIC_INVEST_SUPABASE_URL、NEXT_PUBLIC_INVEST_SUPABASE_ANON_KEY），設定步驟見
        supabase-invest/README.md。
      </div>
    );
  }
  if (checking) {
    return <div className="py-10 text-center text-sm text-muted-foreground">檢查投資帳號登入狀態中…</div>;
  }
  if (!session) return <InvestLoginCard />;
  return <InvestWorkspace email={session.user.email ?? ""} />;
}

function InvestLoginCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: err } = await investDb.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);
    if (err) setError(err.message === "Invalid login credentials" ? "帳號或密碼錯誤" : err.message);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">登入投資帳號</h2>
        <p className="mt-1 text-xs text-muted-foreground">這是個人投資資料庫的帳號，與 ERP 帳號分開。</p>
      </div>
      <label className="block space-y-1">
        <span className={labelClass}>Email</span>
        <input
          type="email"
          autoComplete="username"
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label className="block space-y-1">
        <span className={labelClass}>密碼</span>
        <input
          type="password"
          autoComplete="current-password"
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "登入中…" : "登入"}
      </Button>
    </form>
  );
}

function InvestWorkspace({ email }: { email: string }) {
  const [data, setData] = useState<InvestData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<InvestTab>("holdings");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  /** 從持股警告跳到「拆股／配股」時預填的帳戶與代號 */
  const [actionPrefill, setActionPrefill] = useState<{ accountId: string; symbol: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadInvestData());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const portfolio = useMemo(() => (data ? computePortfolio(data.trades, data.actions) : null), [data]);

  async function handleLogout() {
    await investDb.auth.signOut();
    toast.success("已登出投資帳號");
  }

  if (loadError && !data) {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-card p-6 text-sm">
        <p className="text-destructive">讀取投資資料失敗：{loadError}</p>
        <Button type="button" variant="outline" onClick={() => void reload()}>
          重試
        </Button>
      </div>
    );
  }
  if (!data || !portfolio) {
    return <div className="py-10 text-center text-sm text-muted-foreground">讀取投資資料中…</div>;
  }

  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const filter = accountFilter !== "all" && accountsById.has(accountFilter) ? accountFilter : "all";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex w-fit flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/30 p-1"
          role="tablist"
          aria-label="我的投資頁籤"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setActionPrefill(null);
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                tab === t.id
                  ? "border border-border bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.accounts.length > 1 && (
            <select
              className={cn(inputClass, "w-auto")}
              value={filter}
              onChange={(e) => setAccountFilter(e.target.value)}
              aria-label="帳戶篩選"
            >
              <option value="all">全部帳戶</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <Button type="button" variant="outline" onClick={() => setAccountDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            新增帳戶
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void reload()}
            disabled={loading}
            aria-label="重新整理"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button type="button" variant="ghost" onClick={() => void handleLogout()} title={email}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">登出</span>
          </Button>
        </div>
      </div>

      {data.accounts.length === 0 && (
        <div className="space-y-2 rounded-xl border border-dashed border-border bg-card p-5 text-sm">
          <p className="font-medium text-foreground">第一步：建立帳戶</p>
          <p className="text-muted-foreground">
            每個券商建立一個帳戶，例如「台股－XX證券」「美股－複委託」。建好後到「交易紀錄」匯入對帳單。
          </p>
          <Button type="button" onClick={() => setAccountDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            新增帳戶
          </Button>
        </div>
      )}

      {tab === "holdings" && (
        <HoldingsTab
          data={data}
          portfolio={portfolio}
          accountFilter={filter}
          onReload={reload}
          onFixWarning={(accountId, symbol) => {
            setActionPrefill({ accountId, symbol });
            setTab("actions");
          }}
        />
      )}
      {tab === "trades" && <TradesTab data={data} portfolio={portfolio} accountFilter={filter} onReload={reload} />}
      {tab === "dividends" && <DividendsTab data={data} accountFilter={filter} onReload={reload} />}
      {tab === "actions" && (
        <CorporateActionsTab data={data} accountFilter={filter} onReload={reload} prefill={actionPrefill} />
      )}

      <AccountFormDialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen} onSaved={reload} />
    </div>
  );
}
