"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { TABLE_MATERIAL_SWATCHES, SWATCH_SELECT } from "@/lib/products-db";
import type { SwatchRow } from "@/types/products";
import { Button } from "@/components/ui/button";
import { SwatchImageDropzone } from "@/components/products/swatch-image-dropzone";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { Palette, Plus, Pencil, Trash2, ArrowUp, ArrowDown, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";

type SwatchCategory = "wood" | "fabric" | "door" | "cloth";

const CATEGORY_TABS: { key: SwatchCategory; label: string }[] = [
  { key: "wood", label: "材種" },
  { key: "fabric", label: "座墊" },
  { key: "door", label: "門片種類" },
  { key: "cloth", label: "布樣" },
];

function mapSwatch(r: Record<string, unknown>): SwatchRow {
  return {
    id: String(r.id),
    category:
      r.category === "fabric" || r.category === "door" || r.category === "cloth"
        ? r.category
        : "wood",
    name: String(r.name ?? ""),
    name_en: r.name_en != null ? String(r.name_en) : null,
    image_url: r.image_url != null && String(r.image_url) ? String(r.image_url) : null,
    sort_order: Number(r.sort_order ?? 0),
    is_active: r.is_active !== false,
  };
}

/** 材料色樣管理：介紹表第二頁色樣區的主檔（材種／座墊／門片／布樣），供各系列勾選 */
export function MaterialSwatchesPanel({ isAdmin = false }: { isAdmin?: boolean } = {}) {
  const [rows, setRows] = useState<SwatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<SwatchCategory>("wood");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editRow, setEditRow] = useState<SwatchRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<SwatchRow | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from(TABLE_MATERIAL_SWATCHES)
      .select(SWATCH_SELECT)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      setLoadError(error.message || "載入色樣失敗");
      setLoading(false);
      return;
    }
    setRows(((data ?? []) as Record<string, unknown>[]).map(mapSwatch));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const tabRows = useMemo(() => rows.filter((r) => r.category === tab), [rows, tab]);
  const demoCount = useMemo(
    () => rows.filter((r) => r.name.startsWith("[DEMO]")).length,
    [rows]
  );

  async function toggleActive(row: SwatchRow) {
    const { error } = await supabase
      .from(TABLE_MATERIAL_SWATCHES)
      .update({ is_active: !row.is_active })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "更新失敗");
      return;
    }
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, is_active: !row.is_active } : r))
    );
  }

  /** 與同分類相鄰列交換 sort_order（同時把兩列寫回） */
  async function move(row: SwatchRow, dir: -1 | 1) {
    const list = tabRows;
    const idx = list.findIndex((r) => r.id === row.id);
    const other = list[idx + dir];
    if (!other) return;
    // sort_order 相同時（例如都是 0）交換無效，改以列表位置重排整個分類
    const needsReindex = list.some((r, i) => i > 0 && r.sort_order <= list[i - 1].sort_order);
    const updates: { id: string; sort_order: number }[] = [];
    if (needsReindex) {
      const reordered = [...list];
      reordered.splice(idx, 1);
      reordered.splice(idx + dir, 0, row);
      reordered.forEach((r, i) => updates.push({ id: r.id, sort_order: i }));
    } else {
      updates.push({ id: row.id, sort_order: other.sort_order });
      updates.push({ id: other.id, sort_order: row.sort_order });
    }
    for (const u of updates) {
      const { error } = await supabase
        .from(TABLE_MATERIAL_SWATCHES)
        .update({ sort_order: u.sort_order })
        .eq("id", u.id);
      if (error) {
        toast.error(error.message || "排序更新失敗");
        return;
      }
    }
    fetchData();
  }

  async function performDelete() {
    if (!deleteRow) return;
    const row = deleteRow;
    setDeleteRow(null);
    const { error } = await supabase.from(TABLE_MATERIAL_SWATCHES).delete().eq("id", row.id);
    if (error) {
      toast.error(error.message || "刪除失敗（若已被系列引用請先取消勾選）");
      return;
    }
    toast.success("已刪除色樣");
    fetchData();
  }

  async function deleteDemoRows() {
    const { error } = await supabase
      .from(TABLE_MATERIAL_SWATCHES)
      .delete()
      .like("name", "[DEMO]%");
    if (error) {
      toast.error(error.message || "刪除示意資料失敗");
      return;
    }
    toast.success("已刪除全部 [DEMO] 示意色樣");
    fetchData();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary" aria-hidden>
            <Palette className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">產品資料</p>
            <p className="text-xl font-semibold text-foreground">材料色樣</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {demoCount > 0 && isAdmin && (
            <Button
              variant="outline"
              className="h-8 px-3 text-xs text-destructive"
              onClick={deleteDemoRows}
            >
              <Trash2 className="h-3.5 w-3.5" />
              刪除示意資料（{demoCount}）
            </Button>
          )}
          <Button
            className="h-8 px-3 text-xs"
            onClick={() => {
              setEditRow(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            新增色樣
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-4 py-3">
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5" role="tablist" aria-label="色樣分類">
            {CATEGORY_TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  tab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setTab(key)}
              >
                {label}（{rows.filter((r) => r.category === key).length}）
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            介紹表色樣區順序依此排序（材種 → 門片 → 座墊 → 布樣）
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">載入色樣中…</div>
        ) : loadError ? (
          <div className="p-6 space-y-2">
            <p className="text-sm text-destructive break-all">{loadError}</p>
            <Button variant="outline" className="h-8 px-3 text-xs" onClick={fetchData}>
              重新載入
            </Button>
          </div>
        ) : tabRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            尚無{CATEGORY_TABS.find((t) => t.key === tab)?.label}色樣，請點「新增色樣」建立。
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {tabRows.map((row, idx) => (
              <li key={row.id} className={cn("flex items-center gap-3 px-4 py-2.5", !row.is_active && "opacity-50")}>
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                  {row.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.image_url} alt={row.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">無照片</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{row.name_en?.trim() || "—"}</p>
                </div>
                {!row.image_url && (
                  <span className="shrink-0 rounded-full border border-accent-warn/60 px-2 py-0.5 text-[10px] text-accent-warn whitespace-nowrap">
                    缺照片
                  </span>
                )}
                {!row.is_active && (
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    已停用
                  </span>
                )}
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={idx === 0}
                    onClick={() => move(row, -1)}
                    aria-label={`${row.name} 上移`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={idx === tabRows.length - 1}
                    onClick={() => move(row, 1)}
                    aria-label={`${row.name} 下移`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <button
                    type="button"
                    onClick={() => toggleActive(row)}
                    className={cn(
                      "mx-1 h-6 w-10 shrink-0 rounded-full border transition-colors",
                      row.is_active ? "border-primary bg-primary/80" : "border-border bg-muted"
                    )}
                    role="switch"
                    aria-checked={row.is_active}
                    aria-label={`${row.name} ${row.is_active ? "停用" : "啟用"}`}
                  >
                    <span
                      className={cn(
                        "block h-4 w-4 rounded-full bg-card shadow transition-transform",
                        row.is_active ? "translate-x-5" : "translate-x-1"
                      )}
                    />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditRow(row);
                      setEditorOpen(true);
                    }}
                    aria-label={`編輯 ${row.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => setDeleteRow(row)}
                    aria-label={`刪除 ${row.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <SwatchEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        row={editRow}
        defaultCategory={tab}
        nextSortOrder={tabRows.length ? Math.max(...tabRows.map((r) => r.sort_order)) + 1 : 0}
        onSuccess={fetchData}
      />

      <ConfirmDialog
        open={deleteRow != null}
        onOpenChange={(open) => !open && setDeleteRow(null)}
        title="是否確定刪除色樣？"
        description={
          deleteRow ? (
            <>
              <p className="font-medium text-foreground">色樣：「{deleteRow.name}」</p>
              <p className="mt-2 text-muted-foreground">
                已勾選此色樣的系列介紹表將一併移除該色樣。此操作無法復原。
              </p>
            </>
          ) : null
        }
        confirmLabel="確定刪除"
        onConfirm={performDelete}
        destructive
      />
    </div>
  );
}

function SwatchEditorDialog({
  open,
  onOpenChange,
  row,
  defaultCategory,
  nextSortOrder,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: SwatchRow | null;
  defaultCategory: SwatchCategory;
  nextSortOrder: number;
  onSuccess: () => void;
}) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<SwatchCategory>(defaultCategory);
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCategory(row?.category ?? defaultCategory);
      setName(row?.name ?? "");
      setNameEn(row?.name_en ?? "");
      setImageUrl(row?.image_url || null);
      setError(null);
      setTimeout(() => firstRef.current?.focus(), 0);
    }
  }, [open, row, defaultCategory]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("請輸入色樣名稱");
      return;
    }
    setSaving(true);
    const payload = {
      category,
      name: name.trim(),
      name_en: nameEn.trim() || null,
      image_url: imageUrl || null,
    };
    const res = row
      ? await supabase.from(TABLE_MATERIAL_SWATCHES).update(payload).eq("id", row.id)
      : await supabase
          .from(TABLE_MATERIAL_SWATCHES)
          .insert({ ...payload, sort_order: nextSortOrder });
    setSaving(false);
    if (res.error) {
      toast.error(res.error.message || "儲存色樣失敗");
      setError(res.error.message || "儲存色樣失敗");
      return;
    }
    toast.success(row ? "已更新色樣" : "已新增色樣");
    onOpenChange(false);
    onSuccess();
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="swatch-editor-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {row ? "編輯色樣" : "新增色樣"}
              </Dialog.Title>
              <p id="swatch-editor-desc" className="mt-1 text-sm text-muted-foreground">
                色樣會顯示在產品介紹表第二頁底部
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
              <span className="text-xs text-muted-foreground">分類</span>
              <div className="inline-flex self-start rounded-lg border border-border bg-muted/30 p-0.5">
                {CATEGORY_TABS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      category === key
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setCategory(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">色樣照片（自動裁切為 1:1；可先建檔後補）</span>
              <SwatchImageDropzone value={imageUrl} onChange={setImageUrl} disabled={saving} />
              {!imageUrl && (
                <p className="text-[11px] text-accent-warn">尚無照片：此色樣不會出現在介紹表，補上後才會顯示</p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="swatch-name" className="text-xs text-muted-foreground">
                  名稱（中）*
                </label>
                <input
                  ref={firstRef}
                  id="swatch-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="例：白橡木"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="swatch-name-en" className="text-xs text-muted-foreground">
                  英文標示
                </label>
                <input
                  id="swatch-name-en"
                  type="text"
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="例：Oak / Natural white"
                />
              </div>
            </div>
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
