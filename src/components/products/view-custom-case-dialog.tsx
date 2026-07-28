"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  formatCaseDimensions,
  CUSTOM_CASE_KIND_LABEL,
  type CustomCaseRow,
} from "@/lib/custom-cases-db";

export interface ViewCustomCaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: CustomCaseRow | null;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground whitespace-pre-wrap break-words">{value ?? "—"}</span>
    </div>
  );
}

/** 訂製案例／加工區項目檢視 */
export function ViewCustomCaseDialog({ open, onOpenChange, row }: ViewCustomCaseDialogProps) {
  if (!row) return null;
  const kindLabel = CUSTOM_CASE_KIND_LABEL[row.kind];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-lg focus:outline-none flex flex-col"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 pt-5 pb-3">
            <div className="flex items-center gap-2.5">
              <Dialog.Title className="text-base font-semibold text-foreground">
                {row.case_code ? `${row.case_code} · ` : ""}
                {row.name_zh || "未命名"}
              </Dialog.Title>
              {row.kind === "custom" ? (
                row.published ? (
                  <Badge className="shrink-0">官網發佈中</Badge>
                ) : (
                  <Badge variant="secondary" className="shrink-0">未發佈</Badge>
                )
              ) : (
                <Badge variant="secondary" className="shrink-0">{kindLabel}</Badge>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="關閉"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {row.image_url && (
              <div className="overflow-hidden rounded-lg border border-border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={row.image_url}
                  alt={row.name_zh || "主圖"}
                  className="max-h-72 w-full object-contain"
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="英文名稱" value={row.name_en} />
              <Field label="類別" value={row.category} />
              <Field label="材質／木種" value={row.material} />
              <Field label="尺寸" value={formatCaseDimensions(row)} />
              {row.kind === "processing" && (
                <Field
                  label="定價"
                  value={row.base_price != null ? row.base_price.toLocaleString() : null}
                />
              )}
              {row.kind === "custom" && <Field label="完成年份" value={row.completed_year} />}
            </div>

            {row.kind === "custom" && (row.story_zh || row.story_en) && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                {row.story_zh && <Field label="案例故事（中文）" value={row.story_zh} />}
                {row.story_en && <Field label="案例故事（英文）" value={row.story_en} />}
              </div>
            )}

            {row.notes && <Field label="內部備註" value={row.notes} />}

            {row.process_image_urls.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">
                  {row.kind === "custom" ? "製作過程圖" : "紀錄照片"}（{row.process_image_urls.length} 張）
                </span>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {row.process_image_urls.map((url, i) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block aspect-square overflow-hidden rounded-lg border border-border bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`圖 ${i + 1}`} className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
