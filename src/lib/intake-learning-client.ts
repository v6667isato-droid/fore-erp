import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { IntakeDiff } from "@/lib/intake-learning";

/**
 * 儲存後把員工的修正送去學習（不等待、不擋儲存流程）；學到規則時提示，失敗只記錄不打擾使用者。
 * 呼叫前請先用 diffIntakeCustomer／diffIntakeOrder 過濾，沒有值得學的修正就不要呼叫（省 AI 用量）。
 */
export function submitIntakeLearning(payload: {
  kind: "customer" | "order";
  text: string;
  diffs: IntakeDiff[];
  orderId?: string | null;
}): void {
  if (payload.diffs.length === 0 || !payload.text.trim()) return;
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/customer-intake/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          kind: payload.kind,
          text: payload.text,
          diffs: payload.diffs,
          order_id: payload.orderId ?? null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        console.warn("intake learning failed:", body?.error ?? res.status);
        return;
      }
      const rules: string[] = Array.isArray(body?.rules) ? body.rules : [];
      if (rules.length > 0) toast.success(`AI 已學到：${rules.join("；")}`, { duration: 6000 });
    } catch (err) {
      console.warn("intake learning failed:", err);
    }
  })();
}
