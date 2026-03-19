"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ClipboardList } from "lucide-react";

interface ChannelInfo {
  id: string;
  name: string;
}

interface ChannelOrderRow {
  id: string;
  order_number: string;
  order_date: string | null;
  notes: string | null;
  expected_delivery_date: string | null;
  status: string;
  total_amount: number;
}

function viewOrder(orderId: string) {
  if (!orderId) return;
  window.open(`/print/order/${orderId}`, "_blank", "noopener,noreferrer");
}

export default function ChannelOrdersPage() {
  const params = useParams<{ channelId: string }>();
  const channelId = params?.channelId ?? "";

  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<ChannelOrderRow[]>([]);

  const title = useMemo(() => {
    const name = channel?.name?.trim();
    return name ? `通路訂單（${name}）` : "通路訂單";
  }, [channel?.name]);

  const fetchData = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    try {
      const [channelRes, ordersRes] = await Promise.all([
        supabase.from("channels").select("id, name").eq("id", channelId).single(),
        supabase
          .from("orders")
          .select(
            "id, order_number, order_date, internal_notes, expected_delivery_date, status, total_amount, customers!inner(channel_id)"
          )
          .eq("customers.channel_id", channelId)
          .order("order_date", { ascending: false })
          .limit(200),
      ]);

      if (!channelRes.error && channelRes.data) {
        setChannel({ id: String(channelRes.data.id), name: String(channelRes.data.name ?? "") });
      } else {
        setChannel(null);
      }

      if (ordersRes.error) {
        setOrders([]);
        return;
      }

      setOrders(
        ((ordersRes.data ?? []) as any[]).map((r) => ({
          id: String(r.id),
          order_number: String(r.order_number ?? ""),
          order_date: r.order_date ?? null,
          notes: r.internal_notes != null ? String(r.internal_notes) : null,
          expected_delivery_date: r.expected_delivery_date ?? null,
          status: r.status ?? "—",
          total_amount: Number(r.total_amount ?? 0),
        }))
      );
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-xl border border-border bg-card shadow-sm p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ClipboardList className="h-4 w-4" />
              {title}
            </div>
            <Button type="button" variant="outline" className="h-8 px-3 text-sm" onClick={fetchData}>
              重新整理
            </Button>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground mt-4">載入中…</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-4">尚無訂單紀錄</p>
          ) : (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">訂單編號</th>
                    <th className="pb-2 pr-4 font-medium">下單日</th>
                    <th className="pb-2 pr-4 font-medium">備註</th>
                    <th className="pb-2 pr-4 font-medium">預計交貨</th>
                    <th className="pb-2 pr-4 font-medium">狀態</th>
                    <th className="pb-2 text-right font-medium">金額</th>
                    <th className="pb-2 pl-4 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-b border-border/60">
                      <td className="py-2.5 pr-4 font-mono text-foreground">{o.order_number}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {o.order_date ? o.order_date.slice(0, 10) : "—"}
                      </td>
                      <td
                        className="py-2.5 pr-4 text-muted-foreground max-w-[12rem] truncate"
                        title={o.notes ?? undefined}
                      >
                        {o.notes?.trim() || "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {o.expected_delivery_date ? o.expected_delivery_date.slice(0, 10) : "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{o.status}</td>
                      <td className="py-2.5 text-right font-medium text-foreground">
                        ${o.total_amount.toLocaleString()}
                      </td>
                      <td className="py-2.5 pl-4">
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 px-2 text-xs"
                          onClick={() => viewOrder(o.id)}
                        >
                          檢視訂單
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

