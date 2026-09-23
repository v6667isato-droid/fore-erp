"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { describeActorLabel } from "@/lib/order-audit-trail";

/** 操作紀錄的操作者顯示名稱：email → 員工姓名（其次 user_profiles.full_name），來源標記 → 通路名等 */
export function useAuditActorNames() {
  const [channelNames, setChannelNames] = useState<Record<string, string>>({});
  const [nameByEmail, setNameByEmail] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [chRes, empRes, profileRes] = await Promise.all([
        supabase.from("channels").select("id, name"),
        supabase.from("employees").select("name, email").is("deleted_at", null),
        supabase.from("user_profiles").select("email, full_name"),
      ]);
      if (cancelled) return;

      const channels: Record<string, string> = {};
      for (const c of chRes.data ?? []) channels[String(c.id)] = String(c.name ?? "");
      setChannelNames(channels);

      const byEmail: Record<string, string> = {};
      for (const p of (profileRes.data ?? []) as { email?: unknown; full_name?: unknown }[]) {
        const em = String(p.email ?? "").trim().toLowerCase();
        const nm = String(p.full_name ?? "").trim();
        if (em && nm) byEmail[em] = nm;
      }
      for (const e of (empRes.data ?? []) as { name?: unknown; email?: unknown }[]) {
        const em = String(e.email ?? "").trim().toLowerCase();
        const nm = String(e.name ?? "").trim();
        if (em && nm) byEmail[em] = nm;
      }
      setNameByEmail(byEmail);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const actorText = useCallback(
    (email: string | null, label: string | null): string => {
      if (email) return nameByEmail[email.trim().toLowerCase()] ?? email;
      return describeActorLabel(label ?? "", channelNames);
    },
    [channelNames, nameByEmail],
  );

  return { channelNames, nameByEmail, actorText };
}
