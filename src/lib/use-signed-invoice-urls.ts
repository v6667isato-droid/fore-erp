"use client";

import { useEffect, useMemo, useState } from "react";
import { signInvoiceFileUrls, type InvoiceBucket } from "@/lib/invoice-file";

const EMPTY = new Map<string, string | null>();

/**
 * 發票附件限時網址：傳入 storage 路徑清單，回傳 path → 限時網址。
 * 取值為 undefined＝產生中；null＝產生失敗（多半是檔案已不在 storage）。
 * 路徑清單變動（新上傳、改名歸檔）時自動重新產生；已產生的網址沿用，新路徑產生前畫面先顯示載入中。
 */
export function useSignedInvoiceUrls(
  bucket: InvoiceBucket,
  paths: Array<string | null | undefined>,
): Map<string, string | null> {
  const key = useMemo(
    () => Array.from(new Set(paths.filter((p): p is string => Boolean(p)))).sort().join("\n"),
    [paths],
  );
  const [urls, setUrls] = useState<Map<string, string | null>>(EMPTY);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const requested = key.split("\n");
    signInvoiceFileUrls(bucket, requested).then((signed) => {
      if (cancelled) return;
      setUrls(new Map(requested.map((p) => [p, signed.get(p) ?? null])));
    });
    return () => {
      cancelled = true;
    };
  }, [bucket, key]);

  return urls;
}
