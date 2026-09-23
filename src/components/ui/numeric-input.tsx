"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  formatNumericValue,
  isAllowedNumericKey,
  parseNumericText,
  sanitizeNumericText,
} from "@/lib/numeric-input";

type NumericInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange" | "inputMode"
> & {
  value: number | null | undefined;
  /** 清空時給 null，由呼叫端決定要存 0、null 或預設值 */
  onValueChange: (value: number | null) => void;
  /** 允許小數（預設只允許整數） */
  allowDecimal?: boolean;
};

/**
 * 全站數字輸入欄位（規則見 CLAUDE.md「數字輸入欄位」）：
 * - 0／空值顯示為空白（placeholder 0），可直接輸入，不必先刪 0
 * - 只能輸入數字（擋掉文字、e、+、- 等），貼上時自動清理
 * - 手機跳數字鍵盤
 *
 * 保留 type="number"：桌機 Chrome 會在數字欄位自動關閉注音輸入法，改成 text 會讓數字鍵打出注音。
 */
function NumericInput({
  value,
  onValueChange,
  allowDecimal = false,
  className,
  placeholder = "0",
  step,
  onKeyDown,
  onPaste,
  onBlur,
  onWheel,
  ...props
}: NumericInputProps) {
  // 輸入中的原始文字；失焦後改回依 value 顯示，避免輸入到一半被父層改寫（如清空數量被補回 1）
  const [draft, setDraft] = React.useState<string | null>(null);

  function commit(text: string) {
    setDraft(text);
    onValueChange(parseNumericText(text, allowDecimal));
  }

  return (
    <input
      {...props}
      type="number"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      step={step ?? (allowDecimal ? "any" : 1)}
      placeholder={placeholder}
      value={draft ?? formatNumericValue(value)}
      onChange={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
        if (!isAllowedNumericKey(e.key, allowDecimal)) e.preventDefault();
      }}
      onPaste={(e) => {
        onPaste?.(e);
        if (e.defaultPrevented) return;
        const raw = e.clipboardData.getData("text");
        const cleaned = sanitizeNumericText(raw, allowDecimal);
        if (cleaned === raw) return;
        // number 欄位拿不到游標位置，含雜字（逗號、全形、文字）時整格改成清理後的數字
        e.preventDefault();
        if (cleaned) commit(cleaned);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
      onWheel={(e) => {
        onWheel?.(e);
        // 避免游標停在欄位上捲動頁面時，滾輪悄悄改掉數字
        if (document.activeElement === e.currentTarget) e.currentTarget.blur();
      }}
      className={cn(
        "h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/30 read-only:cursor-default",
        className
      )}
    />
  );
}

export { NumericInput };
