"use client";

import { useId } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
export const labelClass = "text-xs text-muted-foreground";

/** 今天（本地時區）YYYY-MM-DD */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 金額：台幣到元，外幣到分 */
export function formatMoney(n: number | null | undefined, currency = "TWD"): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const digits = currency === "TWD" ? 0 : 2;
  return n.toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 股數、單價：最多 4 位小數（零股、美股碎股、基金單位） */
export function formatNumber(n: number | null | undefined, maxDigits = 4): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("zh-TW", { maximumFractionDigits: maxDigits });
}

export function formatPercent(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
}

/** 台股慣例：賺錢紅色、賠錢綠色 */
export function pnlClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || Math.abs(n) < 1e-9) return "text-foreground";
  return n > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400";
}

export function InvestDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-background shadow-lg focus:outline-none",
            wide ? "max-w-3xl" : "max-w-lg"
          )}
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-foreground">{title}</Dialog.Title>
              {description && <div className="mt-1 text-xs text-muted-foreground">{description}</div>}
            </div>
            <Dialog.Close className="rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100 focus:outline-none">
              <XIcon className="size-4" />
              <span className="sr-only">關閉</span>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 帳戶下拉選單 */
export function AccountSelect({
  accounts,
  value,
  onChange,
  className,
}: {
  accounts: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <select className={cn(inputClass, className)} value={value} onChange={(e) => onChange(e.target.value)}>
      {accounts.length === 0 && <option value="">（尚未建立帳戶）</option>}
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

/** 金額前的幣別符號 */
export function currencyPrefix(currency: string): string {
  return currency === "TWD" ? "NT$" : currency === "USD" ? "US$" : currency;
}

/** 正數加「+」的金額（損益類） */
export function formatSignedMoney(n: number | null | undefined, currency = "TWD"): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${formatMoney(n, currency)}`;
}

/** 卡片：標題列＋內容（表格滿版），可加頁尾 */
export function Panel({
  title,
  subtitle,
  actions,
  footer,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            {title}
          </h2>
          {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="border-t border-border">{children}</div>
      {footer}
    </section>
  );
}

/** 一個數字：標籤＋數值＋補充說明 */
export function Stat({
  label,
  value,
  sub,
  valueClassName,
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueClassName?: string;
  size?: "md" | "lg";
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-semibold tabular-nums text-foreground",
          size === "lg" ? "text-xl sm:text-2xl" : "text-base",
          valueClassName
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** 分段選擇（篩選列用 md；卡片角落用 sm） */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "sm",
  className,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex gap-0.5 rounded-md border border-border bg-muted/40 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-auto whitespace-nowrap rounded transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
            size === "md" ? "h-10 min-w-14 px-3 text-sm sm:h-8" : "h-7 min-w-9 px-2.5 text-xs",
            value === o.value
              ? "border border-border bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 搜尋框（放大鏡圖示＋輸入框） */
export function SearchInput({
  value,
  onChange,
  placeholder = "搜尋代號或名稱",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex h-10 items-center gap-2 rounded-lg border border-input bg-background px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:h-9",
        className
      )}
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </label>
  );
}
