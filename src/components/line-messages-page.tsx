"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

type LineMessageRow = {
  id: string;
  line_user_id: string;
  content?: string | null;
  message_type?: string | null;
  customer_id: string | null;
  created_at: string;
};

function messageBody(r: LineMessageRow): string {
  const s = r.content ?? "";
  return typeof s === "string" ? s : "";
}

export function LineMessagesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LineMessageRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: qErr } = await supabase
      .from("line_messages")
      .select("id, line_user_id, content, message_type, customer_id, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as LineMessageRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = origin ? `${origin}/api/line-webhook` : "/api/line-webhook";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground leading-relaxed">
        <p className="font-medium text-foreground mb-2">LINE Webhook 網址</p>
        <p className="break-all font-mono text-[13px] text-foreground">{webhookUrl}</p>
        <p className="mt-3">
          請在 LINE Developers 的 Messaging API 設定中將 Webhook URL 設為上方網址，並啟用
          Webhook。伺服器會以環境變數 <code className="text-foreground">LINE_CHANNEL_SECRET</code>{" "}
          驗證簽章；請確認已寫入 .env.local（Vercel 等請同步設定）。
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          顯示最近 200 筆；客戶若在「客戶資料」中填寫相同的 LINE userId（欄位{" "}
          <span className="text-foreground">line_user_id</span> 或既有{" "}
          <span className="text-foreground">line_id</span>
          ），會自動關聯。
        </p>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          重新整理
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">載入中…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground space-y-2">
          <p>尚無訊息。請依序檢查：</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              在 LINE 對<strong>這個官方帳號</strong>傳一則<strong>純文字</strong>（貼圖、照片不算）。
            </li>
            <li>
              到 Supabase → <strong>Table Editor</strong> → <code className="text-foreground">line_messages</code>{" "}
              是否有新列；若沒有，代表 Webhook 沒寫入成功。
            </li>
            <li>
              Vercel 的 <code className="text-foreground">SUPABASE_SERVICE_ROLE_KEY</code> 必須是 Dashboard → API 的{" "}
              <strong>service_role</strong>（長度與內容應與 <strong>anon</strong> 金鑰不同）。若誤貼成 anon，寫入會被 RLS 擋下。
            </li>
            <li>
              確認已在 Supabase 執行過 migration，資料表 <code className="text-foreground">line_messages</code>{" "}
              存在。
            </li>
          </ul>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">時間</th>
                <th className="px-3 py-2 font-medium">LINE userId</th>
                <th className="px-3 py-2 font-medium">客戶 ID</th>
                <th className="px-3 py-2 font-medium">內容</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/80 last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("zh-TW")}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] max-w-[200px] truncate" title={r.line_user_id}>
                    {r.line_user_id}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground" title={r.customer_id ?? ""}>
                    {r.customer_id ? r.customer_id.slice(0, 8) + "…" : "—"}
                  </td>
                  <td className="px-3 py-2 max-w-md whitespace-pre-wrap break-words">{messageBody(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
