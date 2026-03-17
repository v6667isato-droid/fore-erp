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
  /** 受控模式：由外部控制開關時傳入，不傳則使用內建 Trigger 按鈕 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 若提供則進入「編輯客戶」模式，根據此 ID 載入與更新客戶資料 */
  customerId?: string | null;
}

function isColumnError(err: { message?: string } | null): boolean {
  const msg = (err?.message ?? "").toLowerCase();
  return /column .* does not exist/i.test(msg) || /could not find.*column/i.test(msg) || /schema cache/i.test(msg);
}

export function AddCustomerDialog({
  channels = [],
  onSuccess,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  customerId,
}: AddCustomerDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined && controlledOnOpenChange !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (controlledOnOpenChange ?? (() => {})) : setInternalOpen;
  const firstFocusRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [contact, setContact] = useState("");
  const [lineId, setLineId] = useState("");
  const [igAccount, setIgAccount] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [channelId, setChannelId] = useState("");
  const [contactMethod, setContactMethod] = useState("");
  const [alias, setAlias] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function resetOrLoad() {
      if (!open) return;
      setError(null);
      // 編輯模式：根據 customerId 載入既有客戶資料
      if (customerId) {
        const { data, error } = await supabase
          .from("customers")
          .select(
            "name, alias, contact_person, phone, line_id, ig_account, delivery_address, notes, source, customer_type, channel_id, contact_method"
          )
          .eq("id", customerId)
          .single();
        if (error || !data) {
          toast.error(error?.message || "讀取客戶資料失敗");
          return;
        }
        setName(data.name ?? "");
        setContact(data.contact_person ?? "");
        setPhone(data.phone ?? "");
        setLineId(data.line_id ?? "");
        setIgAccount(data.ig_account ?? "");
        setDeliveryAddress(data.delivery_address ?? "");
        setNotes(data.notes ?? "");
        setSource(data.source ?? "");
        setCustomerType(data.customer_type ?? "");
        setChannelId(data.channel_id ? String(data.channel_id) : "");
        setContactMethod((data as any).contact_method ?? "");
        setAlias((data as any).alias ?? "");
      } else {
        // 新增模式：清空欄位
        setName("");
        setContact("");
        setPhone("");
        setLineId("");
        setIgAccount("");
        setDeliveryAddress("");
        setNotes("");
        setSource("");
        setCustomerType("");
        setChannelId("");
        setContactMethod("");
        setAlias("");
      }
    }
    void resetOrLoad();
  }, [open, customerId]);

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
      setError("請輸入客戶名稱");
      return;
    }
    setAdding(true);
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
    let err;
    if (customerId) {
      // 編輯模式：更新既有客戶
      const res = await supabase.from("customers").update(payload).eq("id", customerId);
      err = res.error;
    } else {
      // 新增模式：插入新客戶（保留原有 column fallback 邏輯）
      let insertPayload: Record<string, unknown> = { ...full };
      let res = await supabase.from("customers").insert(insertPayload);
      err = res.error;
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
          const next = { ...insertPayload };
          delete next[key];
          res = await supabase.from("customers").insert(next);
          err = res.error;
          if (!err) break;
          if (!isColumnError(err)) break;
        }
      }
    }
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
        const res = await supabase.from("customers").insert(next);
        err = res.error;
        if (!err) break;
        if (!isColumnError(err)) break;
      }
    }
    setAdding(false);
    if (err) {
      const msg = customerId ? "更新客戶失敗" : "新增客戶失敗";
      toast.error(err.message || msg);
      setError(err.message || msg);
      return;
    }
    toast.success(customerId ? "已更新客戶" : "已新增客戶");
    setOpen(false);
    onSuccess();
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <Plus className="h-4 w-4" />
            新增客戶
          </button>
        </Dialog.Trigger>
      )}
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
                {customerId ? "編輯客戶" : "新增客戶"}
              </Dialog.Title>
              <p id="add-customer-desc" className="mt-1 text-sm text-muted-foreground">
                {customerId
                  ? "更新客戶基本資料與聯絡方式。"
                  : "填寫客戶基本資料與聯絡方式。"}
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
                  <label htmlFor="add-customer-name" className="text-xs text-muted-foreground">
                    客戶名稱 <span className="text-destructive">*</span>
                  </label>
                  <input
                    ref={firstFocusRef}
                    id="add-customer-name"
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
                    id="add-customer-alias"
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
                    <label htmlFor="add-customer-contact" className="text-xs text-muted-foreground">
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
                    id="add-customer-contact"
                    type="text"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="聯絡人姓名"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <label htmlFor="add-customer-contact-method" className="text-xs text-muted-foreground">
                    聯絡方式
                  </label>
                  <select
                    id="add-customer-contact-method"
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
              <label htmlFor="add-customer-phone" className="text-xs text-muted-foreground">
                電話
              </label>
              <input
                id="add-customer-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="聯絡電話"
              />
            </div>

            {/* 4. 地址 */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-customer-address" className="text-xs text-muted-foreground">
                聯絡地址
              </label>
              <input
                id="add-customer-address"
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
                  <label htmlFor="add-customer-source" className="text-xs text-muted-foreground">
                    客戶來源
                  </label>
                  <select
                    id="add-customer-source"
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
                  <label htmlFor="add-customer-type" className="text-xs text-muted-foreground">
                    客戶種類
                  </label>
                  <select
                    id="add-customer-type"
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
                <label htmlFor="add-customer-channel" className="text-xs text-muted-foreground">
                  所屬通路
                </label>
                <select
                  id="add-customer-channel"
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
                  <label htmlFor="add-customer-line" className="text-xs text-muted-foreground">
                    LINE ID
                  </label>
                  <input
                    id="add-customer-line"
                    type="text"
                    value={lineId}
                    onChange={(e) => setLineId(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="LINE ID"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <label htmlFor="add-customer-ig" className="text-xs text-muted-foreground">
                    IG 帳號
                  </label>
                  <input
                    id="add-customer-ig"
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
                {adding ? "儲存中…" : "儲存"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
