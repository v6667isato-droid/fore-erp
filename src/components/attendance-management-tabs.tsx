"use client";

import { useState } from "react";
import { AttendanceHistoryPanel } from "@/components/attendance-history-panel";
import { AttendanceImporterPanel } from "@/components/attendance-importer-panel";
import { PublicHolidaysAdminCard } from "@/components/public-holidays-admin-card";
import { cn } from "@/lib/utils";

export type AttendanceManagementTabKey = "import" | "history" | "employees";

/**
 * 出勤管理：匯入分析、歷史查詢（daily_attendance）、員工資料。
 * 用於 /admin/attendance 與儀表板「出勤管理」區塊。
 * 傳入 `activeTab` 時為受控模式（與頂欄說明連動）。
 */
export function AttendanceManagementTabs({
  activeTab: activeTabProp,
  onActiveTabChange,
}: {
  activeTab?: AttendanceManagementTabKey;
  onActiveTabChange?: (t: AttendanceManagementTabKey) => void;
} = {}) {
  const [internalTab, setInternalTab] = useState<AttendanceManagementTabKey>("import");
  const controlled = activeTabProp !== undefined;
  const tab = controlled ? activeTabProp! : internalTab;

  function selectTab(next: AttendanceManagementTabKey) {
    if (!controlled) setInternalTab(next);
    onActiveTabChange?.(next);
  }

  const [holidayRefreshTick, setHolidayRefreshTick] = useState(0);

  return (
    <div className="flex flex-col gap-5">
      <PublicHolidaysAdminCard onMutate={() => setHolidayRefreshTick((n) => n + 1)} />
      <div
        className="inline-flex rounded-xl border border-border bg-muted/30 p-1 shadow-inner"
        role="tablist"
        aria-label="出勤管理區塊"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "import"}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            tab === "import"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => selectTab("import")}
        >
          匯入分析
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            tab === "history"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => selectTab("history")}
        >
          歷史查詢
        </button>
      </div>
      {tab === "import" ? (
        <AttendanceImporterPanel holidayRefreshTick={holidayRefreshTick} />
      ) : (
        <AttendanceHistoryPanel />
      )}
    </div>
  );
}
