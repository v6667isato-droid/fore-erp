"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { CostStatisticsPage } from "@/components/cost-statistics-page";
import { SalesStatisticsPage } from "@/components/sales-statistics-page";
import { EmployeeCompletionStatisticsPage } from "@/components/employee-completion-statistics-page";

export type StatisticsTab = "cost" | "sales" | "employee";

function parseStatisticsTab(raw: string | null): StatisticsTab {
  if (raw === "sales" || raw === "employee" || raw === "cost") return raw;
  return "cost";
}

/**
 * 成本統計頁：成本統計／銷售統計／員工完成統計分頁。
 * 分頁狀態同步至 ?statisticsTab=，與 customersTab、procurementTab 慣例一致。
 */
export function CostStatisticsTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = useMemo(
    () => parseStatisticsTab(searchParams.get("statisticsTab")),
    [searchParams],
  );

  const setTab = useCallback(
    (next: StatisticsTab) => {
      router.replace(
        next === "cost"
          ? "/?page=cost_statistics"
          : `/?page=cost_statistics&statisticsTab=${next}`,
      );
    },
    [router],
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        className="inline-flex flex-wrap self-start rounded-xl border border-border bg-muted/30 p-1 shadow-inner"
        role="tablist"
        aria-label="統計分頁"
      >
        {(
          [
            { id: "cost" as const, label: "成本統計" },
            { id: "sales" as const, label: "銷售統計" },
            { id: "employee" as const, label: "員工完成統計" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              tab === item.id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "cost" && <CostStatisticsPage />}
      {tab === "sales" && <SalesStatisticsPage />}
      {tab === "employee" && <EmployeeCompletionStatisticsPage />}
    </div>
  );
}
