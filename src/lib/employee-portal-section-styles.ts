/**
 * 員工儀表板（/employee-portal）各區塊統一標題、副標、卡片與表格層級。
 */
export const epSection = {
  /** 標準區塊外框 */
  card: "rounded-2xl border border-border/90 bg-card p-6 shadow-sm sm:p-8",
  /** 帶淡 ring（行事曆、開會紀錄等） */
  cardRing:
    "rounded-2xl border border-border/90 bg-card p-6 shadow-sm sm:p-8 ring-1 ring-border/30",
  /** 區塊主標題 h3 */
  title: "text-base font-semibold tracking-tight text-foreground",
  /** 標題下說明、技術提示 */
  subtitle: "text-xs text-muted-foreground",
  /** 標題列（左 icon + 右文字） */
  headerRow: "mb-5 flex items-center gap-2",
  /** 標題列（內容多行時頂對齊） */
  headerRowStart: "mb-5 flex items-start gap-2",
  /** 標題列含右側按鈕 */
  headerRowBetween:
    "mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
  /** 左側圖示（secondary） */
  iconBox:
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary",
  /** 左側圖示（primary 淡底） */
  iconBoxPrimary:
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary",
  /** 左側圖示（工坊輪替 amber） */
  iconBoxAmber:
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-warn/15 text-accent-warn",
  /** 表格外框 */
  tableWrap: "overflow-x-auto rounded-xl border border-border/60",
  /** 資料表本體 */
  table: "w-full min-w-[640px] text-sm",
  /** 表頭列 */
  thead: "border-b border-border bg-muted/30 text-left text-xs text-muted-foreground",
  /** 表頭儲存格 */
  th: "px-4 py-3 font-medium",
  /** 內文儲存格（一般） */
  td: "px-4 py-3",
} as const;
