"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  OrderOverviewCard,
  fetchOrderOverviewById,
  type OverviewOrder,
} from "@/components/orders-overview-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function OrderOverviewDialog({
  open,
  onOpenChange,
  orderId,
  onEditOrder,
  /** 通路客戶端等：隱藏「編輯訂單」 */
  showEditButton = true,
  /** 通路訂單等：米色摘要區、較寬浮層 */
  visualTone = "default",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string | null;
  onEditOrder?: (orderId: string) => void;
  showEditButton?: boolean;
  visualTone?: "default" | "warm";
}) {
  const [data, setData] = useState<OverviewOrder | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !orderId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchOrderOverviewById(orderId).then((row) => {
      if (cancelled) return;
      if (!row) {
        toast.error("無法載入訂單總覽");
        setData(null);
      } else {
        setData(row);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-0 shadow-lg focus:outline-none",
            visualTone === "warm" ? "max-w-5xl" : "max-w-4xl"
          )}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                訂單總覽
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                品項負責人與生產工序進度
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" className="h-8 w-8 p-0 shrink-0" aria-label="關閉">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="p-5">
            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">載入中…</p>
            ) : data ? (
              <OrderOverviewCard
                order={data}
                variant="dialog"
                visualTone={visualTone}
                showEditButton={showEditButton}
                onEditOrder={
                  showEditButton && orderId && onEditOrder
                    ? () => onEditOrder(orderId)
                    : undefined
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">無法顯示資料</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
