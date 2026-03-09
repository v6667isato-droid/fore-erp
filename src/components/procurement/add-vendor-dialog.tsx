"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";

export interface AddVendorDialogProps {
  onSuccess: () => void;
  /** 既有廠商類別，用於下拉建議（可修改輸入） */
  categoryOptions?: string[];
}

const DEFAULT_CATEGORIES = ["木材", "五金", "其他", "雜項"];

export function AddVendorDialog({ onSuccess, categoryOptions = DEFAULT_CATEGORIES }: AddVendorDialogProps) {
  const [open, setOpen] = useState(false);
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
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryList = [...new Set([...DEFAULT_CATEGORIES, ...(categoryOptions ?? [])])];

  useEffect(() => {
    if (open) {
      setMainCategory("");
      setName("");
      setContactPerson("");
      setAddress("");
      setPhone("");
      setFax("");
      setEmail("");
      setWebsite("");
      setTaxId("");
      setNotes("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (open && firstRef.current) setTimeout(() => firstRef.current?.focus(), 0);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("請輸入廠商名稱");
      return;
    }
    setAdding(true);
    const payload: Record<string, unknown> = {
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
    const { error: err } = await supabase.from("vendors").insert(payload);
    setAdding(false);
    if (err) {
      toast.error(err.message || "新增廠商失敗");
      setError(err.message || "新增廠商失敗");
      return;
    }
    toast.success("已新增廠商");
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
          新增廠商
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="add-vendor-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">新增廠商</Dialog.Title>
              <p id="add-vendor-desc" className="mt-1 text-sm text-muted-foreground">建立一筆廠商資料</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-vendor-category" className="text-xs text-muted-foreground">廠商類別（main_category）</label>
              <input
                ref={firstRef}
                id="add-vendor-category"
                list="add-vendor-category-list"
                type="text"
                value={mainCategory}
                onChange={(e) => setMainCategory(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="可輸入新增或選擇，例：木材、五金"
                title="存入資料表 vendors 的 main_category 欄位"
              />
              <datalist id="add-vendor-category-list">
                {categoryList.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-vendor-name" className="text-xs text-muted-foreground">廠商名稱 *</label>
              <input id="add-vendor-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="廠商名稱" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-vendor-contact" className="text-xs text-muted-foreground">聯絡人</label>
              <input id="add-vendor-contact" type="text" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="聯絡人" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-vendor-address" className="text-xs text-muted-foreground">地址</label>
              <input id="add-vendor-address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="地址" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-vendor-phone" className="text-xs text-muted-foreground">電話</label>
              <input id="add-vendor-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="電話" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-vendor-fax" className="text-xs text-muted-foreground">傳真</label>
              <input id="add-vendor-fax" type="tel" value={fax} onChange={(e) => setFax(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="傳真" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-vendor-email" className="text-xs text-muted-foreground">EMAIL</label>
              <input id="add-vendor-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="Email" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-vendor-website" className="text-xs text-muted-foreground">網站</label>
              <input id="add-vendor-website" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="https://..." />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-vendor-tax-id" className="text-xs text-muted-foreground">統一編號</label>
              <input id="add-vendor-tax-id" type="text" value={taxId} onChange={(e) => setTaxId(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="統一編號 (tax_id)" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-vendor-notes" className="text-xs text-muted-foreground">備註</label>
              <textarea id="add-vendor-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[72px]" placeholder="備註 (notes)" />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild><Button type="button" variant="ghost" disabled={adding}>取消</Button></Dialog.Close>
              <Button type="submit" disabled={adding}>{adding ? "新增中…" : "新增廠商"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
