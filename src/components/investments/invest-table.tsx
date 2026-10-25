"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 我的投資各分頁共用的表格：第一欄凍結在左邊，往右捲動時欄位名稱與標的不會跑掉。
 * 用 border-separate（border-collapse 下 sticky 儲存格的框線會消失），框線畫在儲存格上；
 * 凍結欄與表頭、分組列的底色都要不透明，捲動時才不會透出底下的內容。
 */

const headBg = "bg-[color-mix(in_srgb,var(--color-muted)_45%,var(--color-card))]";
const groupBg = "bg-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-card))]";
const rowHover = "[&:hover>*]:bg-[color-mix(in_srgb,var(--color-muted)_35%,var(--color-card))]";
const edgePadding = "first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
/** 凍結欄右側一條分隔線；表格往右捲動後再加一道陰影，提示左邊還有被蓋住的內容 */
const stickyCol =
  "sticky left-0 shadow-[inset_-1px_0_0_var(--color-border)] group-data-[scrolled=true]/table:shadow-[inset_-1px_0_0_var(--color-border),6px_0_8px_-6px_rgba(0,0,0,0.18)]";

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;
type Align = keyof typeof ALIGN;

export function InvestTable({
  minWidth,
  className,
  children,
}: {
  /** 表格最小寬度（px）；容器比這窄時左右捲動 */
  minWidth: number;
  className?: string;
  children: React.ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);
  return (
    <div
      className={cn(
        // 最後一列不畫底線，避免和外框或卡片頁尾的線疊成兩條
        "group/table relative w-full overflow-x-auto [&_tbody:last-of-type>tr:last-child>*]:border-b-0",
        className
      )}
      data-scrolled={scrolled}
      onScroll={(e) => {
        const next = e.currentTarget.scrollLeft > 0;
        if (next !== scrolled) setScrolled(next);
      }}
    >
      <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function HeadCell({
  sticky = false,
  align = "left",
  className,
  ...props
}: React.ComponentProps<"th"> & { sticky?: boolean; align?: Align }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b border-border px-3 py-2.5 text-xs font-medium text-muted-foreground",
        headBg,
        ALIGN[align],
        edgePadding,
        sticky && cn(stickyCol, "z-[2]"),
        className
      )}
      {...props}
    />
  );
}

export function Row({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn(rowHover, className)} {...props} />;
}

/** 一般儲存格；sticky 時改成列標題（th scope="row"），固定在左邊 */
export function Cell({
  sticky = false,
  align = "left",
  className,
  ...props
}: React.ComponentProps<"td"> & { sticky?: boolean; align?: Align }) {
  const classes = cn(
    "border-b border-border/60 bg-card px-3 py-2.5 align-middle",
    ALIGN[align],
    align === "right" && "whitespace-nowrap tabular-nums",
    edgePadding,
    sticky && cn(stickyCol, "z-[1] font-normal"),
    className
  );
  if (sticky) return <th scope="row" className={classes} {...(props as React.ComponentProps<"th">)} />;
  return <td className={classes} {...props} />;
}

/** 分組標題列（例如台股／美股、月份、年度）：名稱固定在左邊，小計緊接在後面（靠左，表格很寬時也看得到） */
export function GroupRow({ label, detail, colSpan }: { label: React.ReactNode; detail?: React.ReactNode; colSpan: number }) {
  return (
    <tr>
      <th
        scope="rowgroup"
        className={cn(
          "z-[1] whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-semibold text-foreground sm:text-sm",
          groupBg,
          stickyCol,
          edgePadding
        )}
      >
        {label}
      </th>
      {colSpan > 1 && (
        <td
          colSpan={colSpan - 1}
          className={cn(
            "whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs text-muted-foreground tabular-nums",
            groupBg,
            edgePadding
          )}
        >
          {detail}
        </td>
      )}
    </tr>
  );
}

/** 表格下方的「顯示更多」 */
export function ShowMoreFooter({
  shown,
  total,
  onShowMore,
}: {
  shown: number;
  total: number;
  onShowMore: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 sm:px-5">
      <span className="text-xs text-muted-foreground">
        顯示 {shown.toLocaleString("zh-TW")} 筆，共 {total.toLocaleString("zh-TW")} 筆
      </span>
      {shown < total && (
        <button
          type="button"
          onClick={onShowMore}
          className="h-10 rounded-md border border-border bg-background px-3.5 text-sm text-foreground transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring sm:h-9"
        >
          顯示更多
        </button>
      )}
    </div>
  );
}
