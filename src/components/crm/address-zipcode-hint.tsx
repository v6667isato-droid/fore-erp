"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

/** 去掉地址開頭已有的 3～6 碼郵遞區號，回傳既有區號與剩餘地址 */
function stripLeadingZip(addr: string): { zip: string | null; rest: string } {
  const m = /^(\d{3,6})\s*(.*)$/.exec(addr.trim());
  if (m) return { zip: m[1], rest: m[2].trim() };
  return { zip: null, rest: addr.trim() };
}

export interface AddressZipcodeHintProps {
  address: string;
  /** 按「帶入」時以「郵遞區號 + 空格 + 地址」回寫地址欄位 */
  onApply: (next: string) => void;
}

/**
 * 台灣 3+3 郵遞區號自動查詢提示列：地址停止輸入後自動查中華郵政，
 * 顯示查到的區號並可一鍵帶入地址開頭。查不到時不顯示。
 */
export function AddressZipcodeHint({ address, onApply }: AddressZipcodeHintProps) {
  const [result, setResult] = useState<{ zipcode: string; rest: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const lastQueried = useRef("");

  useEffect(() => {
    const { rest } = stripLeadingZip(address);
    // 同一地址（例如剛帶入區號後）不重查，保留現有結果
    if (rest && rest === lastQueried.current) return;
    setResult(null);
    setLoading(false);
    if (rest.length < 6 || !/[縣市]/.test(rest)) {
      lastQueried.current = "";
      return;
    }
    const mySeq = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/zipcode", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ address: rest }),
        });
        const json = (await res.json()) as { zipcode?: string | null };
        if (seq.current !== mySeq) return;
        setLoading(false);
        lastQueried.current = rest;
        setResult(json.zipcode ? { zipcode: json.zipcode, rest } : null);
      } catch {
        if (seq.current === mySeq) setLoading(false);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [address]);

  if (loading) {
    return <p className="text-[11px] text-muted-foreground">查詢郵遞區號中…</p>;
  }
  if (!result) return null;

  const applied = stripLeadingZip(address).zip === result.zipcode;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <span>
        3+3郵遞區號：<span className="font-medium text-foreground">{result.zipcode}</span>
        {result.zipcode.length === 3 && "（補上門牌號可查完整6碼）"}
      </span>
      {applied ? (
        <span className="text-primary">已帶入</span>
      ) : (
        <button
          type="button"
          onClick={() => onApply(`${result.zipcode} ${result.rest}`)}
          className="rounded-md border border-input bg-background px-2 py-0.5 text-[11px] text-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          帶入地址
        </button>
      )}
    </div>
  );
}
