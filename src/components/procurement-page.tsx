"use client";

import { useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { ProcurementPurchasesTab } from "@/components/procurement/procurement-purchases-tab";
import { ProcurementMaterialsTab } from "@/components/procurement/procurement-materials-tab";
import { VendorsPage } from "@/components/vendors-page";

export type ProcurementTab = "purchases" | "materials" | "vendors";

function parseProcurementTab(raw: string | null): ProcurementTab {
  if (raw === "materials" || raw === "vendors" || raw === "purchases") return raw;
  return "purchases";
}

export interface ProcurementPageProps {
  isAdmin?: boolean;
}

export function ProcurementPage({ isAdmin = false }: ProcurementPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = useMemo(
    () => parseProcurementTab(searchParams.get("procurementTab")),
    [searchParams],
  );

  const setTab = useCallback(
    (next: ProcurementTab) => {
      router.replace(`/?page=procurement&procurementTab=${next}`);
    },
    [router],
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        className="inline-flex flex-wrap rounded-xl border border-border bg-muted/30 p-1 shadow-inner"
        role="tablist"
        aria-label="採購管理分頁"
      >
        {(
          [
            { id: "purchases" as const, label: "採購明細" },
            { id: "materials" as const, label: "採購物料" },
            { id: "vendors" as const, label: "廠商" },
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

      {tab === "purchases" && (
        <ProcurementPurchasesTab onNavigateToVendors={() => setTab("vendors")} isAdmin={isAdmin} />
      )}
      {tab === "materials" && <ProcurementMaterialsTab />}
      {tab === "vendors" && <VendorsPage isAdmin={isAdmin} />}
    </div>
  );
}
