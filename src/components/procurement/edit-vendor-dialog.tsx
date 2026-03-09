"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { VendorRow } from "@/types/procurement";

export interface EditVendorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: VendorRow | null;
  onSuccess: () => void;
  categoryOptions?: string[];
}

const DEFAULT_CATEGORIES = ["木材", "五金", "其他", "雜項"];

export function EditVendorDialog({ open, onOpenChange, row, onSuccess, categoryOptions = DEFAULT_CATEGORIES }: EditVendorDialogProps) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [mainCategory, setMainCategory] = useState("");
  const [name, setName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [fax, setFax] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [taxId, setTaxId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryList = [...new Set([...DEFAULT_CATEGORIES, ...(categoryOptions ?? [])])];

  useEffect(() => {
    if (open && row) {
      setMainCategory(row.main_category ?? "");
      setName(row.name ?? "");
      setContactPerson(row.contact_person ?? "");
      setAddress(row.address ?? "");
      setPhone(row.phone ?? "");
      setFax(row.fax ?? "");
      setEmail(row.email ?? "");
      setTaxId(row.tax_id ?? "");
      setNotes(row.notes ?? "");
      setError(null);
    }
  }, [open, row]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    setError(null);
    if (!name.trim()) {
      setError("請輸入廠商名稱");
      return;
    }
    setSaving(true);
    const payload = {
      main_category: mainCategory.trim() || null,
      name: name.trim(),
      contact_person: contactPerson.trim() || null,
      address: address.trim() || null,
      phone: phone.trim() || null,
      fax: fax.trim() || null,
      email: email.trim() || null,
      website: website.trim() || null,
      tax_id: taxId.trim() || null,
      notes: notes.trim() || null,
    };
    const { error: err } = await supabase.from("vendors").update(payload).eq("id", row.id);
    setSaving(false);
    if (err) {
      toast.error(err.message || "更新廠商失敗");
      setError(err.message || "更新廠商失敗");
      return;
    }
    toast.success("已更新廠商");
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
          aria-describedby="edit-vendor-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">編輯廠商</Dialog.Title>
              <p id="edit-vendor-desc" className="mt-1 text-sm text-muted-foreground">修改廠商資料</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-vendor-category" className="text-xs text-muted-foreground">類別</label>
              <input
                ref={firstRef}
                id="edit-vendor-category"
                list="edit-vendor-category-list"
                type="text"
                value={mainCategory}
                onChange={(e) => setMainCategory(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <datalist id="edit-vendor-category-list">
                {categoryList.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-vendor-name" className="text-xs text-muted-foreground">廠商名稱 *</label>
              <input id="edit-vendor-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-vendor-contact" className="text-xs text-muted-foreground">聯絡人</label>
              <input id="edit-vendor-contact" type="text" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-vendor-address" className="text-xs text-muted-foreground">地址</label>
              <input id="edit-vendor-address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-vendor-phone" className="text-xs text-muted-foreground">電話</label>
              <input id="edit-vendor-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-vendor-fax" className="text-xs text-muted-foreground">傳真</label>
              <input id="edit-vendor-fax" type="tel" value={fax} onChange={(e) => setFax(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-vendor-email" className="text-xs text-muted-foreground">EMAIL</label>
              <input id="edit-vendor-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-vendor-website" className="text-xs text-muted-foreground">網站</label>
              <input id="edit-vendor-website" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="https://..." />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-vendor-tax-id" className="text-xs text-muted-foreground">統一編號</label>
              <input id="edit-vendor-tax-id" type="text" value={taxId} onChange={(e) => setTaxId(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-vendor-notes" className="text-xs text-muted-foreground">備註</label>
              <textarea id="edit-vendor-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[72px]" />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild><Button type="button" variant="ghost" disabled={saving}>取消</Button></Dialog.Close>
              <Button type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
