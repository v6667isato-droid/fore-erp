"use client";

import { useEffect, useRef } from "react";

/**
 * 頁面從背景切回前景（手機切回瀏覽器、切回分頁）時呼叫 callback。
 * 手機常把分頁留在背景，切回來不會重新載入，畫面會停在上次打開時的資料（甚至是前一天）。
 */
export function usePageVisible(callback: () => void, enabled = true): void {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;
    function onVisibilityChange() {
      if (document.visibilityState === "visible") callbackRef.current();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [enabled]);
}
