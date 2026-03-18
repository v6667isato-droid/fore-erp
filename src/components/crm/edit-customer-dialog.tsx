"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { CustomerRow } from "@/types/crm";

export interface ChannelOption {
  id: string;
  name: string;
}

export interface EditCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: CustomerRow | null;
  channels?: ChannelOption[];
  onSuccess: () => void;
}

function isColumnError(err: { message?: string } | null): boolean {
  const msg = (err?.message ?? "").toLowerCase();
  return /column .* does not exist/i.test(msg) || /could not find.*column/i.test(msg) || /schema cache/i.test(msg);
}

export function EditCustomerDialog({ open, onOpenChange, row, channels = [], onSuccess }: EditCustomerDialogProps) {
  const firstFocusRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [lineId, setLineId] = useState("");
  const [igAccount, setIgAccount] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [channelId, setChannelId] = useState("");
  const [contactMethod, setContactMethod] = useState("");
  const [alias, setAlias] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && row) {
      setName(row.name ?? "");
      setAlias((row as any).alias ?? "");
      setContact((row as any).contact_person ?? "");
      setPhone(row.phone ?? "");
      setLineId(row.line_id ?? "");
      setIgAccount(row.ig_account ?? "");
      setDeliveryAddress(row.delivery_address ?? "");
      setNotes(row.notes ?? "");
      setSource(row.source ?? "");
      setCustomerType(row.customer_type ?? "");
      setChannelId(row.channel_id ?? "");
      setContactMethod((row as any).contact_method ?? "");
      setError(null);
    }
  }, [open, row]);

  useEffect(() => {
    if (open && firstFocusRef.current) {
      const t = setTimeout(() => firstFocusRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    setError(null);
    if (!name.trim()) {
      setError("請輸入客戶名稱");
      return;
    }
    setSaving(true);
    const full: Record<string, unknown> = {
      name: name.trim(),
      alias: alias.trim() || null,
      contact_person: contact.trim() || null,
      phone: phone.trim() || null,
      line_id: lineId.trim() || null,
      ig_account: igAccount.trim() || null,
      delivery_address: deliveryAddress.trim() || null,
      notes: notes.trim() || null,
      source: source.trim() || null,
      customer_type: customerType.trim() || null,
      channel_id: channelId.trim() || null,
      contact_method: contactMethod.trim() || null,
    };
    let payload: Record<string, unknown> = { ...full };
    let { error: err } = await supabase.from("customers").update(payload).eq("id", row.id);
    if (err && isColumnError(err)) {
      const optional = [
        "alias",
        "notes",
        "source",
        "customer_type",
        "delivery_address",
        "line_id",
        "ig_account",
        "phone",
        "contact_method",
      ];
      for (const key of optional) {
        const next = { ...payload };
        delete next[key];
        const res = await supabase.from("customers").update(next).eq("id", row.id);
        err = res.error;
        if (!err) break;
        if (!isColumnError(err)) break;
      }
    }
    setSaving(false);
    if (err) {
      toast.error(err.message || "更新客戶失敗");
      setError(err.message || "更新客戶失敗");
      return;
    }
    toast.success("已更新客戶");
    onOpenChange(false);
    onSuccess();
  }

  if (!row) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="edit-customer-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                編輯客戶
              </Dialog.Title>
              <p id="edit-customer-desc" className="mt-1 text-sm text-muted-foreground">
                修改客戶基本資料與聯絡方式。
              </p>
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
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            {/* 1. 客戶名稱（含別名） */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-end gap-2">
                <div className="flex-1 flex flex-col gap-1">
                  <label htmlFor="edit-customer-name" className="text-xs text-muted-foreground">
                    客戶名稱 <span className="text-destructive">*</span>
                  </label>
                  <input
                    ref={firstFocusRef}
                    id="edit-customer-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="客戶名稱"
                    required
                  />
                </div>
                <div className="w-32 flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">別名</span>
                  <input
                    id="edit-customer-alias"
                    type="text"
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    className="h-9 rounded-lg border border-input bg-muted px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="例如 小明"
                  />
                </div>
              </div>
            </div>

            {/* 2. 聯絡人 + 聯絡方式（同一列） */}
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-3">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="edit-customer-contact" className="text-xs text-muted-foreground">
                      聯絡人
                    </label>
                    <button
                      type="button"
                      onClick={() => setContact(name)}
                      className="text-[11px] rounded-md border border-input bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      同客戶名稱
                    </button>
                  </div>
                  <input
                    id="edit-customer-contact"
                    type="text"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="聯絡人姓名"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <label htmlFor="edit-customer-contact-method" className="text-xs text-muted-foreground">
                    聯絡方式
                  </label>
                  <select
                    id="edit-customer-contact-method"
                    value={contactMethod}
                    onChange={(e) => setContactMethod(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">未指定</option>
                    <option value="line">LINE</option>
                    <option value="ig">IG</option>
                    <option value="fb">FB</option>
                    <option value="email">Email</option>
                    <option value="bingxueLine">秉學Line</option>
                    <option value="others">Others</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 3. 電話 */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-customer-phone" className="text-xs text-muted-foreground">
                電話
              </label>
              <input
                id="edit-customer-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="聯絡電話"
              />
            </div>

            {/* 4. 地址 */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-customer-address" className="text-xs text-muted-foreground">
                聯絡地址
              </label>
              <input
                id="edit-customer-address"
                type="text"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                className="min-h-[2.5rem] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="送貨／收件地址"
              />
            </div>

            {/* 5. 客戶來源 + 客戶種類（同一列） */}
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-3">
                <div className="flex-1 space-y-1.5">
                  <label htmlFor="edit-customer-source" className="text-xs text-muted-foreground">
                    客戶來源
                  </label>
                  <select
                    id="edit-customer-source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">未指定</option>
                    <option value="網路">網路</option>
                    <option value="客戶引介">客戶引介</option>
                    <option value="設計師引介">設計師引介</option>
                    <option value="展覽(好感生活)">展覽(好感生活)</option>
                    <option value="展覽(木質生活)">展覽(木質生活)</option>
                    <option value="通路(謝木木工作室)">通路(謝木木工作室)</option>
                  </select>
                </div>
                <div className="flex-1 space-y-1.5">
                  <label htmlFor="edit-customer-type" className="text-xs text-muted-foreground">
                    客戶種類
                  </label>
                  <select
                    id="edit-customer-type"
                    value={customerType}
                    onChange={(e) => setCustomerType(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">未指定</option>
                    <option value="一般民眾">一般民眾</option>
                    <option value="合作通路">合作通路</option>
                    <option value="室內設計師">室內設計師</option>
                    <option value="建築師">建築師</option>
                    <option value="餐廳">餐廳</option>
                    <option value="政府機關">政府機關</option>
                    <option value="木工廠(代工)">木工廠(代工)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 6. 所屬通路 */}
            {channels.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-customer-channel" className="text-xs text-muted-foreground">
                  所屬通路
                </label>
                <select
                  id="edit-customer-channel"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">未指定</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 7. LINE ID + IG（同一列） */}
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-3">
                <div className="flex-1 space-y-1.5">
                  <label htmlFor="edit-customer-line" className="text-xs text-muted-foreground">
                    LINE ID
                  </label>
                  <input
                    id="edit-customer-line"
                    type="text"
                    value={lineId}
                    onChange={(e) => setLineId(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="LINE ID"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <label htmlFor="edit-customer-ig" className="text-xs text-muted-foreground">
                    IG 帳號
                  </label>
                  <input
                    id="edit-customer-ig"
                    type="text"
                    value={igAccount}
                    onChange={(e) => setIgAccount(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Instagram 帳號"
                  />
                </div>
              </div>
            </div>

            {/* 8. 客情備註（保留在最後） */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-customer-notes" className="text-xs text-muted-foreground">客情備註</label>
              <textarea
                id="edit-customer-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="min-h-[80px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="備註、偏好、往來紀錄等"
              />
            </div>
            {/* 通路下單入口改由通路管理設定登入資訊，此處不再編輯 */}
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={saving}>
                  取消
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>
                {saving ? "儲存中…" : "儲存"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
