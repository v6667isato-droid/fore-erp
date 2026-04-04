"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { MessageCircle, RefreshCw, Copy, Check, Users, UserX, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

type LineMessageRow = {
  id: string;
  line_user_id: string;
  content?: string | null;
  text?: string | null;
  message_type?: string | null;
  customer_id: string | null;
  created_at: string;
};

type CustomerMini = { id: string; name: string | null; alias: string | null };

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

/** 依客戶分組；同組內依時間由舊到新（對話順序） */
function groupMessagesByCustomer(
  rows: LineMessageRow[],
  customerById: Map<string, CustomerMini>
): { key: string | null; label: string; rows: LineMessageRow[] }[] {
  const map = new Map<string | null, LineMessageRow[]>();
  for (const r of rows) {
    const k = r.customer_id;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  const entries = [...map.entries()];
  entries.sort((a, b) => {
    if (a[0] === null && b[0] !== null) return -1;
    if (a[0] !== null && b[0] === null) return 1;
    if (a[0] === null && b[0] === null) return 0;
    const ca = customerById.get(a[0]!);
    const cb = customerById.get(b[0]!);
    return customerDisplayName(ca).localeCompare(customerDisplayName(cb), "zh-Hant");
  });

  return entries.map(([key, list]) => ({
    key,
    label:
      key === null
        ? "未綁定客戶"
        : customerDisplayName(customerById.get(key)) || "未知客戶",
    rows: list,
  }));
}

export function LineMessagesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LineMessageRow[]>([]);
  const [customerById, setCustomerById] = useState<Map<string, CustomerMini>>(new Map());
  const [customerOptions, setCustomerOptions] = useState<CustomerMini[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  /** 正在批次套用同一 LINE 帳號（line_user_id）的綁定 */
  const [savingLineUserId, setSavingLineUserId] = useState<string | null>(null);
  /** 分組收折：key 為 customer_id 或 "__unassigned__"；false = 收合 */
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [msgRes, custRes] = await Promise.all([
      supabase.from("line_messages").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("customers").select("id, name, alias").is("deleted_at", null).order("name"),
    ]);

    if (msgRes.error) {
      setError(msgRes.error.message);
      setRows([]);
      setCustomerById(new Map());
      setCustomerOptions([]);
      setLoading(false);
      return;
    }

    const list = (msgRes.data ?? []) as LineMessageRow[];
    setRows(list);

    const opts = (custRes.data ?? []) as CustomerMini[];
    setCustomerOptions(opts);

    const m = new Map<string, CustomerMini>();
    for (const c of opts) {
      m.set(c.id, c);
    }
    const msgCustomerIds = [...new Set(list.map((r) => r.customer_id).filter(Boolean))] as string[];
    const missing = msgCustomerIds.filter((id) => !m.has(id));
    if (missing.length > 0) {
      const { data: extra } = await supabase.from("customers").select("id, name, alias").in("id", missing);
      for (const c of extra ?? []) {
        const row = c as CustomerMini;
        m.set(row.id, row);
      }
    }
    setCustomerById(m);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = origin ? `${origin}/api/line-webhook` : "/api/line-webhook";

  const groups = useMemo(
    () => groupMessagesByCustomer(rows, customerById),
    [rows, customerById]
  );

  function groupSectionKey(key: string | null): string {
    return key ?? "__unassigned__";
  }

  function isGroupExpanded(key: string | null): boolean {
    return expandedGroups[groupSectionKey(key)] !== false;
  }

  function toggleGroup(key: string | null) {
    const k = groupSectionKey(key);
    setExpandedGroups((prev) => {
      const open = prev[k] !== false;
      return { ...prev, [k]: !open };
    });
  }

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

  async function assignCustomer(messageId: string, customerId: string | null) {
    const row = rows.find((r) => r.id === messageId);
    if (!row) return;
    const lineUserId = row.line_user_id;
    const sameLineCount = rows.filter((r) => r.line_user_id === lineUserId).length;

    if (customerId !== null) {
      setSavingLineUserId(lineUserId);
      const { error: uErr } = await supabase
        .from("line_messages")
        .update({ customer_id: customerId })
        .eq("line_user_id", lineUserId);

      if (uErr) {
        toast.error(uErr.message || "更新失敗");
        setSavingLineUserId(null);
        return;
      }

      toast.success(
        sameLineCount > 1
          ? `已綁定客戶（已同步 ${sameLineCount} 則相同 LINE 帳號訊息）`
          : "已綁定客戶"
      );
      setRows((prev) =>
        prev.map((r) => (r.line_user_id === lineUserId ? { ...r, customer_id: customerId } : r))
      );
      if (!customerById.has(customerId)) {
        const c = customerOptions.find((x) => x.id === customerId);
        if (c) {
          setCustomerById((prev) => new Map(prev).set(customerId, c));
        }
      }
      setSavingLineUserId(null);
      return;
    }

    setSavingId(messageId);
    const { error: uErr } = await supabase
      .from("line_messages")
      .update({ customer_id: null })
      .eq("id", messageId);

    if (uErr) {
      toast.error(uErr.message || "更新失敗");
      setSavingId(null);
      return;
    }

    toast.success("已取消此則訊息的綁定");
    setRows((prev) =>
      prev.map((r) => (r.id === messageId ? { ...r, customer_id: null } : r))
    );
    setSavingId(null);
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
              依<strong>客戶</strong>分組顯示。綁定客戶時會依<strong>同一 LINE 帳號</strong>（line_user_id）自動套用至該帳號所有訊息，一併歸到同客戶。
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
        <div className="space-y-4">
          {groups.map((g) => {
            const uniqueUids = [...new Set(g.rows.map((r) => r.line_user_id))];
            const Icon = g.key === null ? UserX : Users;
            const expanded = isGroupExpanded(g.key);
            return (
              <section
                key={g.key ?? "unassigned"}
                className="rounded-xl border border-border bg-card shadow-sm overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  className={cn(
                    "flex w-full flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-3 text-left",
                    "hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  )}
                  aria-expanded={expanded}
                  aria-controls={`line-msg-group-${groupSectionKey(g.key)}`}
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <h2 className="text-sm font-semibold text-foreground">{g.label}</h2>
                  <span className="text-xs text-muted-foreground">（{g.rows.length} 則）</span>
                  {uniqueUids.length > 0 && (
                    <span className="text-[11px] text-muted-foreground font-mono truncate max-w-full sm:ml-auto">
                      LINE userId：{uniqueUids.join(" · ")}
                    </span>
                  )}
                  <span className="sr-only">{expanded ? "收合" : "展開"}訊息列表</span>
                </button>
                {expanded ? (
                  <div id={`line-msg-group-${groupSectionKey(g.key)}`}>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[110px] text-muted-foreground">時間</TableHead>
                      <TableHead className="min-w-[88px] text-muted-foreground">類型</TableHead>
                      <TableHead className="min-w-[160px] text-muted-foreground">綁定客戶</TableHead>
                      <TableHead className="min-w-[160px] text-muted-foreground">LINE userId</TableHead>
                      <TableHead className="text-muted-foreground">內容</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.rows.map((r) => {
                      const t = formatMessageTime(r.created_at);
                      const mt = (r.message_type ?? "text").trim() || "text";
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
                          <TableCell className="align-top whitespace-normal min-w-[180px]">
                            <select
                              className={cn(
                                "h-9 w-full max-w-[220px] rounded-md border border-input bg-background px-2 text-xs",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              )}
                              value={r.customer_id ?? ""}
                              disabled={savingId === r.id || savingLineUserId === r.line_user_id}
                              onChange={(e) => {
                                const v = e.target.value;
                                void assignCustomer(r.id, v === "" ? null : v);
                              }}
                              aria-label="綁定客戶"
                            >
                              <option value="">未綁定</option>
                              {customerOptions.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {customerDisplayName(c)}
                                  {c.name?.trim() && c.alias?.trim() && c.alias !== c.name
                                    ? `（${c.name.trim()}）`
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell className="align-top whitespace-normal">
                            <div className="flex items-start gap-1.5 max-w-[220px]">
                              <code className="break-all text-[11px] leading-snug text-muted-foreground">
                                {r.line_user_id}
                              </code>
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
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
