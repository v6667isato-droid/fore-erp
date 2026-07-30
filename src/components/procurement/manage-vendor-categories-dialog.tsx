"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { FolderTree, Plus, Trash2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { VendorCategoryGroup } from "@/lib/vendor-category-groups";

export interface ManageVendorCategoriesDialogProps {
  /** 既有廠商類別（副類別，來自 vendors.main_category 彙整） */
  categories: string[];
  groups: VendorCategoryGroup[];
  onSuccess: () => void;
}

/** 編輯中的主類別；id 為 null 表示尚未存檔的新群組 */
interface DraftGroup {
  key: string;
  id: string | null;
  name: string;
}

export function ManageVendorCategoriesDialog({ categories, groups, onSuccess }: ManageVendorCategoriesDialogProps) {
  const [open, setOpen] = useState(false);
  const [draftGroups, setDraftGroups] = useState<DraftGroup[]>([]);
  /** 副類別 → 主類別 key；未分類為 "" */
  const [assignment, setAssignment] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const sortedCategories = useMemo(() => [...categories].sort((a, b) => a.localeCompare(b)), [categories]);

  useEffect(() => {
    if (!open) return;
    const drafts = groups.map((g) => ({ key: g.id, id: g.id, name: g.name }));
    const map: Record<string, string> = {};
    for (const c of categories) {
      map[c] = groups.find((g) => g.subcategories.includes(c))?.id ?? "";
    }
    setDraftGroups(drafts);
    setAssignment(map);
    setNewName("");
  }, [open, groups, categories]);

  function addGroup() {
    const name = newName.trim();
    if (!name) return;
    if (draftGroups.some((g) => g.name === name)) {
      toast.error("已有同名主類別");
      return;
    }
    setDraftGroups((prev) => [...prev, { key: `new-${Date.now()}-${prev.length}`, id: null, name }]);
    setNewName("");
  }

  function removeGroup(key: string) {
    setDraftGroups((prev) => prev.filter((g) => g.key !== key));
    setAssignment((prev) => {
      const next = { ...prev };
      for (const c of Object.keys(next)) if (next[c] === key) next[c] = "";
      return next;
    });
  }

  function renameGroup(key: string, name: string) {
    setDraftGroups((prev) => prev.map((g) => (g.key === key ? { ...g, name } : g)));
  }

  async function onSave() {
    const names = draftGroups.map((g) => g.name.trim());
    if (names.some((n) => !n)) {
      toast.error("主類別名稱不可空白");
      return;
    }
    if (new Set(names).size !== names.length) {
      toast.error("主類別名稱重複");
      return;
    }
    setSaving(true);
    const removedIds = groups.filter((g) => !draftGroups.some((d) => d.id === g.id)).map((g) => g.id);
    if (removedIds.length > 0) {
      const { error } = await supabase.from("vendor_category_groups").delete().in("id", removedIds);
      if (error) {
        setSaving(false);
        toast.error(error.message || "刪除主類別失敗");
        return;
      }
    }
    const payload = draftGroups.map((g, i) => ({
      id: g.id,
      name: g.name.trim(),
      subcategories: sortedCategories.filter((c) => assignment[c] === g.key),
      sort_order: i,
    }));
    // 混在同一個 upsert 會把缺 id 的列補成 null 而違反 not-null，故新舊分開送
    const toUpdate = payload.filter((p): p is typeof p & { id: string } => p.id != null);
    const toInsert = payload.filter((p) => p.id == null).map(({ id: _id, ...rest }) => rest);
    if (toUpdate.length > 0) {
      const { error } = await supabase.from("vendor_category_groups").upsert(toUpdate, { onConflict: "id" });
      if (error) {
        setSaving(false);
        toast.error(error.message || "儲存主類別失敗");
        return;
      }
    }
    if (toInsert.length > 0) {
      const { error } = await supabase.from("vendor_category_groups").insert(toInsert);
      if (error) {
        setSaving(false);
        toast.error(error.message || "新增主類別失敗");
        return;
      }
    }
    setSaving(false);
    toast.success("已儲存主類別設定");
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
          <FolderTree className="h-4 w-4" />
          管理主類別
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="manage-vendor-categories-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">管理廠商主類別</Dialog.Title>
              <p id="manage-vendor-categories-desc" className="mt-1 text-sm text-muted-foreground">
                建立主類別（例：工廠硬體），再把既有類別（副類別）歸到主類別底下
              </p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 space-y-5">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">主類別</h3>
              {draftGroups.length === 0 && (
                <p className="text-sm text-muted-foreground">尚未建立主類別</p>
              )}
              <div className="space-y-2">
                {draftGroups.map((g) => (
                  <div key={g.key} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={g.name}
                      onChange={(e) => renameGroup(g.key, e.target.value)}
                      className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                      aria-label="主類別名稱"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive hover:text-destructive"
                      onClick={() => removeGroup(g.key)}
                      aria-label={`刪除主類別 ${g.name}`}
                      title="刪除主類別（底下副類別會變回未分類，不影響廠商資料）"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addGroup();
                    }
                  }}
                  className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="新主類別名稱，例：工廠硬體"
                  aria-label="新主類別名稱"
                />
                <Button type="button" variant="outline" className="h-9 shrink-0 px-3" onClick={addGroup} disabled={!newName.trim()}>
                  <Plus className="h-4 w-4" />
                  新增
                </Button>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">副類別歸屬</h3>
              {sortedCategories.length === 0 ? (
                <p className="text-sm text-muted-foreground">尚無廠商類別（先在廠商資料填類別）</p>
              ) : (
                <div className="rounded-lg border border-border divide-y divide-border">
                  {sortedCategories.map((c) => (
                    <div key={c} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-sm text-foreground">{c}</span>
                      <select
                        value={assignment[c] ?? ""}
                        onChange={(e) => setAssignment((prev) => ({ ...prev, [c]: e.target.value }))}
                        className="h-8 min-w-[9rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        aria-label={`${c} 的主類別`}
                      >
                        <option value="">（未分類）</option>
                        {draftGroups.map((g) => (
                          <option key={g.key} value={g.key}>{g.name || "（未命名）"}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild><Button type="button" variant="ghost" disabled={saving}>取消</Button></Dialog.Close>
            <Button type="button" onClick={onSave} disabled={saving}>{saving ? "儲存中…" : "儲存"}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
