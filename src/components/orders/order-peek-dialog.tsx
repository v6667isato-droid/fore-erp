"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  OrderOverviewCard,
  fetchOrderOverviewById,
  type OverviewOrder,
} from "@/components/orders-overview-page";

/** 訂單內容快速檢視（發票列表點來源訂單用）：唯讀載入單一訂單 OverviewCard */
export function OrderPeekDialog({
  orderId,
  orderNumber,
  open,
  onOpenChange,
}: {
  orderId: string | null;
  orderNumber?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [overview, setOverview] = useState<OverviewOrder | "loading" | null>(null);

  useEffect(() => {
    if (!open || !orderId) return;
    setOverview("loading");
    void fetchOrderOverviewById(orderId).then(setOverview);
  }, [open, orderId]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-base font-semibold text-foreground">
              訂單內容{orderNumber ? `：${orderNumber.replace(/^ORD-/i, "")}` : ""}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent/40"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <div className="mt-3">
            {overview === "loading" || overview == null ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {overview === "loading" ? "載入訂單內容中…" : "無法載入訂單內容"}
              </p>
            ) : (
              <OrderOverviewCard order={overview} variant="dialog" detailLevel="full" showEditButton={false} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
