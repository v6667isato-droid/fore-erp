"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface MobileSortBarProps<K extends string> {
  options: readonly { key: K; label: string }[];
  sortKey: K;
  asc: boolean;
  /** 選了另一個排序欄位（升降冪由呼叫端決定預設值） */
  onKeyChange: (key: K) => void;
  onToggleDir: () => void;
}

/** 卡片模式的排序列：取代表格欄頭的點擊排序（欄位下拉＋升降冪切換） */
export function MobileSortBar<K extends string>({
  options,
  sortKey,
  asc,
  onKeyChange,
  onToggleDir,
}: MobileSortBarProps<K>) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={sortKey}
        onChange={(e) => onKeyChange(e.target.value as K)}
        aria-label="排序欄位"
        className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {options.map((opt) => (
          <option key={opt.key} value={opt.key}>
            排序：{opt.label}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="outline"
        className="h-8 gap-1 px-2 text-xs"
        onClick={onToggleDir}
        aria-label={asc ? "目前升冪，切換為降冪" : "目前降冪，切換為升冪"}
      >
        {asc ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
        {asc ? "升冪" : "降冪"}
      </Button>
    </div>
  );
}
