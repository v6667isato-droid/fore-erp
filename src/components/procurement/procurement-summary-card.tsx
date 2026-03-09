"use client";

import { ShoppingCart } from "lucide-react";

export interface ProcurementSummaryCardProps {
  summaryLabel: string;
  totalSpent: number;
  children: React.ReactNode;
}

export function ProcurementSummaryCard({ summaryLabel, totalSpent, children }: ProcurementSummaryCardProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary" aria-hidden>
          <ShoppingCart className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{summaryLabel}</p>
          <p className="text-xl font-semibold text-foreground">
            NT$ {totalSpent.toLocaleString()}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}
