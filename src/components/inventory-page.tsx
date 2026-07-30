"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { PartsTab } from "@/components/inventory/parts-tab";
import { BomTab } from "@/components/inventory/bom-tab";
import { ReconciliationTab } from "@/components/inventory/reconciliation-tab";

export type InventoryTab = "parts" | "bom" | "reconciliation";

function parseInventoryTab(raw: string | null): InventoryTab {
  if (raw === "parts" || raw === "bom" || raw === "reconciliation") return raw;
  return "parts";
}

export interface InventoryPageProps {
  isAdmin?: boolean;
}

export function InventoryPage({ isAdmin = false }: InventoryPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = useMemo(
    () => parseInventoryTab(searchParams.get("inventoryTab")),
    [searchParams],
  );

  const setTab = useCallback(
    (next: InventoryTab) => {
      router.replace(`/?page=inventory&inventoryTab=${next}`);
    },
    [router],
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        className="inline-flex flex-wrap rounded-xl border border-border bg-muted/30 p-1 shadow-inner"
        role="tablist"
        aria-label="零件庫存分頁"
      >
        {(
          [
            { id: "parts" as const, label: "零件主檔" },
            { id: "bom" as const, label: "BOM 用料表" },
            { id: "reconciliation" as const, label: "出貨對帳" },
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

      {tab === "parts" && <PartsTab isAdmin={isAdmin} />}
      {tab === "bom" && <BomTab isAdmin={isAdmin} />}
      {tab === "reconciliation" && <ReconciliationTab isAdmin={isAdmin} />}
    </div>
  );
}
