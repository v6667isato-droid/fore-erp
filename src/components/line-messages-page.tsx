"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { MessageCircle, RefreshCw, Copy, Check } from "lucide-react";

type LineMessageRow = {
  id: string;
  line_user_id: string;
  content?: string | null;
  text?: string | null;
  message_type?: string | null;
  customer_id: string | null;
  created_at: string;
};

type CustomerMini = { name: string | null; alias: string | null };

function messageBody(r: LineMessageRow): string {
  const s = r.content ?? r.text ?? "";
  return typeof s === "string" ? s : "";
}

function formatMessageTime(iso: string): { main: string; full: string } {
  const d = new Date(iso);
  const full = d.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return { main: full, full };
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return { main: "剛剛", full };
  const min = Math.floor(sec / 60);
  if (min < 60) return { main: `${min} 分鐘前`, full };
  const hr = Math.floor(min / 60);
  if (hr < 24) return { main: `${hr} 小時前`, full };
  const day = Math.floor(hr / 24);
  if (day < 7) return { main: `${day} 天前`, full };
  return {
    main: d.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    full,
  };
}

function customerDisplayName(c: CustomerMini | undefined): string {
  if (!c) return "—";
  const alias = c.alias?.trim();
  const name = c.name?.trim();
  if (alias) return alias;
  if (name) return name;
  return "—";
}

export function LineMessagesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LineMessageRow[]>([]);
  const [customerById, setCustomerById] = useState<Map<string, CustomerMini>>(new Map());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: qErr } = await supabase
      .from("line_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (qErr) {
      setError(qErr.message);
      setRows([]);
      setCustomerById(new Map());
      setLoading(false);
      return;
    }

    const list = (data ?? []) as LineMessageRow[];
    setRows(list);

    const ids = [...new Set(list.map((r) => r.customer_id).filter(Boolean))] as string[];
    if (ids.length === 0) {
      setCustomerById(new Map());
      setLoading(false);
      return;
    }

    const { data: custRows, error: cErr } = await supabase
      .from("customers")
      .select("id, name, alias")
      .in("id", ids);

    if (cErr) {
      console.warn("[line-messages] customers lookup:", cErr);
      setCustomerById(new Map());
    } else {
      const m = new Map<string, CustomerMini>();
      for (const c of custRows ?? []) {
        const row = c as { id: string; name: string | null; alias: string | null };
        m.set(row.id, { name: row.name, alias: row.alias });
      }
      setCustomerById(m);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = origin ? `${origin}/api/line-webhook` : "/api/line-webhook";

  const countLabel = useMemo(() => {
    if (loading) return "載入中…";
    return `${rows.length} 筆`;
  }, [loading, rows.length]);

  async function copyText(text: string, rowKey: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(rowKey);
      window.setTimeout(() => setCopiedId((k) => (k === rowKey ? null : k)), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MessageCircle className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">LINE 官方帳號訊息</p>
            <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">
              顯示最近 200 筆文字訊息；與客戶綁定請在客戶資料填寫相同的 LINE userId。
            </p>
            <p className="mt-2 inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {countLabel}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0 gap-2"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
          重新整理
        </Button>
      </div>

      <details className="group rounded-xl border border-border bg-card text-sm">
        <summary className="cursor-pointer list-none px-4 py-3 font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground group-open:text-foreground">Webhook 設定（開發者）</span>
            <span className="text-xs font-normal text-muted-foreground">點擊展開</span>
          </span>
        </summary>
        <div className="border-t border-border px-4 py-3 text-muted-foreground leading-relaxed space-y-2">
          <p className="break-all font-mono text-[13px] text-foreground">{webhookUrl}</p>
          <p>
            請在 LINE Developers → Messaging API 將 Webhook URL 設為上方網址，並啟用 Webhook。環境變數{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-foreground">LINE_CHANNEL_SECRET</code>{" "}
            需與該頻道 Channel secret 一致（Vercel / .env.local）。
          </p>
        </div>
      </details>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded-lg bg-muted/60" />
          <div className="h-24 animate-pulse rounded-lg bg-muted/60" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/10 px-6 py-12 text-center">
          <MessageCircle className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden />
          <p className="mt-3 text-sm font-medium text-foreground">尚無訊息</p>
          <p className="mt-1 text-sm text-muted-foreground">
            請對官方帳號傳送<strong>純文字</strong>，再按「重新整理」。
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[120px] text-muted-foreground">時間</TableHead>
                <TableHead className="min-w-[100px] text-muted-foreground">類型</TableHead>
                <TableHead className="min-w-[140px] text-muted-foreground">客戶</TableHead>
                <TableHead className="min-w-[180px] text-muted-foreground">LINE userId</TableHead>
                <TableHead className="text-muted-foreground">內容</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const t = formatMessageTime(r.created_at);
                const mt = (r.message_type ?? "text").trim() || "text";
                const cust = r.customer_id ? customerById.get(r.customer_id) : undefined;
                const copyKey = `uid-${r.id}`;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="align-top text-muted-foreground">
                      <time dateTime={r.created_at} title={t.full} className="whitespace-nowrap text-[13px]">
                        {t.main}
                      </time>
                    </TableCell>
                    <TableCell className="align-top">
                      <span className="inline-flex rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                        {mt}
                      </span>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal text-[13px] text-foreground max-w-[160px]">
                      <span className="line-clamp-2" title={customerDisplayName(cust)}>
                        {r.customer_id ? customerDisplayName(cust) : (
                          <span className="text-muted-foreground">未綁定</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <div className="flex items-start gap-1.5 max-w-[220px]">
                        <code className="break-all text-[11px] leading-snug text-muted-foreground">{r.line_user_id}</code>
                        <button
                          type="button"
                          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="複製 userId"
                          onClick={() => void copyText(r.line_user_id, copyKey)}
                        >
                          {copiedId === copyKey ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                          ) : (
                            <Copy className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal text-[13px] leading-relaxed min-w-[200px]">
                      <span className="whitespace-pre-wrap break-words">{messageBody(r)}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
