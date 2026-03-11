"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";

export interface ChannelOption {
  id: string;
  name: string;
}

export interface AddCustomerDialogProps {
  channels?: ChannelOption[];
  onSuccess: () => void;
}

function isColumnError(err: { message?: string } | null): boolean {
  const msg = (err?.message ?? "").toLowerCase();
  return /column .* does not exist/i.test(msg) || /could not find.*column/i.test(msg) || /schema cache/i.test(msg);
}

export function AddCustomerDialog({ channels = [], onSuccess }: AddCustomerDialogProps) {
  const [open, setOpen] = useState(false);
  const firstFocusRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [lineId, setLineId] = useState("");
  const [igAccount, setIgAccount] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [channelId, setChannelId] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setPhone("");
      setLineId("");
      setIgAccount("");
      setDeliveryAddress("");
      setNotes("");
      setSource("");
      setCustomerType("");
      setChannelId("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (open && firstFocusRef.current) {
      const t = setTimeout(() => firstFocusRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("請輸入客戶姓名");
      return;
    }
    setAdding(true);
    const full: Record<string, unknown> = {
      name: name.trim(),
      phone: phone.trim() || null,
      line_id: lineId.trim() || null,
      ig_account: igAccount.trim() || null,
      delivery_address: deliveryAddress.trim() || null,
      notes: notes.trim() || null,
      source: source.trim() || null,
      customer_type: customerType.trim() || null,
      channel_id: channelId.trim() || null,
    };
    let payload: Record<string, unknown> = { ...full };
    let { error: err } = await supabase.from("customers").insert(payload);
    if (err && isColumnError(err)) {
      const optional = ["notes", "source", "customer_type", "delivery_address", "line_id", "ig_account", "phone"];
      for (const key of optional) {
        const next = { ...payload };
        delete next[key];
        const res = await supabase.from("customers").insert(next);
        err = res.error;
        if (!err) break;
        if (!isColumnError(err)) break;
      }
    }
    setAdding(false);
    if (err) {
      toast.error(err.message || "新增客戶失敗");
      setError(err.message || "新增客戶失敗");
      return;
    }
    toast.success("已新增客戶");
    setOpen(false);
    onSuccess();
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <Plus className="h-4 w-4" />
          新增客戶
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="add-customer-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                新增客戶
              </Dialog.Title>
              <p id="add-customer-desc" className="mt-1 text-sm text-muted-foreground">
                填寫客戶基本資料與聯絡方式。
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
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-customer-name" className="text-xs text-muted-foreground">
                姓名 <span className="text-destructive">*</span>
              </label>
              <input
                ref={firstFocusRef}
                id="add-customer-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="客戶姓名"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-customer-source" className="text-xs text-muted-foreground">客戶來源</label>
              <input
                id="add-customer-source"
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                list="add-customer-source-list"
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="選擇或輸入"
              />
              <datalist id="add-customer-source-list">
                <option value="網路" />
                <option value="引介" />
                <option value="回購" />
                <option value="展覽(好感生活)" />
                <option value="展覽(木質生活)" />
                <option value="通路(謝木木工作室)" />
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-customer-type" className="text-xs text-muted-foreground">客戶種類</label>
              <input
                id="add-customer-type"
                type="text"
                value={customerType}
                onChange={(e) => setCustomerType(e.target.value)}
                list="add-customer-type-list"
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="選擇或輸入"
              />
              <datalist id="add-customer-type-list">
                <option value="一般民眾" />
                <option value="合作通路" />
                <option value="室內設計師" />
                <option value="建築師" />
                <option value="餐廳" />
                <option value="政府機關" />
                <option value="木工廠(代工)" />
              </datalist>
            </div>
            {channels.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="add-customer-channel" className="text-xs text-muted-foreground">所屬通路</label>
                <select
                  id="add-customer-channel"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">未指定</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-customer-phone" className="text-xs text-muted-foreground">電話</label>
              <input
                id="add-customer-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="聯絡電話"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-customer-line" className="text-xs text-muted-foreground">LINE ID</label>
              <input
                id="add-customer-line"
                type="text"
                value={lineId}
                onChange={(e) => setLineId(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="LINE ID"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-customer-ig" className="text-xs text-muted-foreground">IG 帳號</label>
              <input
                id="add-customer-ig"
                type="text"
                value={igAccount}
                onChange={(e) => setIgAccount(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Instagram 帳號"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-customer-address" className="text-xs text-muted-foreground">送貨地址</label>
              <input
                id="add-customer-address"
                type="text"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                className="min-h-[2.5rem] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="送貨／收件地址"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-customer-notes" className="text-xs text-muted-foreground">客情備註</label>
              <textarea
                id="add-customer-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="min-h-[80px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="備註、偏好、往來紀錄等"
              />
            </div>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={adding}>
                  取消
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={adding}>
                {adding ? "新增中…" : "新增客戶"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
