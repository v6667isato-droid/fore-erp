"use client";

import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import type { CustomerRow } from "@/types/crm";

export interface ViewCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: CustomerRow | null;
}

function googleMapsUrl(address: string | null | undefined): string {
  if (!address?.trim()) return "#";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <dl className="space-y-2.5 text-sm">{children}</dl>
    </section>
  );
}

export function ViewCustomerDialog({ open, onOpenChange, row }: ViewCustomerDialogProps) {
  if (!row) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="view-customer-desc"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                客戶總覽 — {row.name || "—"}
              </Dialog.Title>
              <p id="view-customer-desc" className="mt-0.5 text-sm text-muted-foreground">
                基本資料、聯絡方式與備註
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 space-y-5">
            <Section title="基本資料">
              <div>
                <dt className="text-muted-foreground">客戶姓名</dt>
                <dd className="font-medium">{row.name || "—"}</dd>
              </div>
              {row.source?.trim() && (
                <div>
                  <dt className="text-muted-foreground">客戶來源</dt>
                  <dd>{row.source.trim()}</dd>
                </div>
              )}
              {row.customer_type?.trim() && (
                <div>
                  <dt className="text-muted-foreground">客戶種類</dt>
                  <dd>{row.customer_type.trim()}</dd>
                </div>
              )}
            </Section>

            <Section title="聯絡方式">
              <div>
                <dt className="text-muted-foreground">電話</dt>
                <dd>{row.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">LINE ID</dt>
                <dd>{row.line_id?.trim() ? row.line_id.trim() : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">IG 帳號</dt>
                <dd>{row.ig_account?.trim() ? row.ig_account.trim() : "—"}</dd>
              </div>
            </Section>

            {(row.delivery_address?.trim() || row.notes?.trim()) && (
              <Section title="送貨與備註">
                {row.delivery_address?.trim() && (
                  <div>
                    <dt className="text-muted-foreground">送貨地址</dt>
                    <dd className="whitespace-pre-wrap">
                      <a
                        href={googleMapsUrl(row.delivery_address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                        title="在 Google 地圖開啟"
                      >
                        {row.delivery_address.trim()}
                      </a>
                    </dd>
                  </div>
                )}
                {row.notes?.trim() && (
                  <div>
                    <dt className="text-muted-foreground">客情備註</dt>
                    <dd className="whitespace-pre-wrap text-muted-foreground">{row.notes.trim()}</dd>
                  </div>
                )}
              </Section>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
