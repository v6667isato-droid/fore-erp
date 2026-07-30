"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { X, Pencil, Check, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { TABLE_PRODUCT_VARIANTS } from "@/lib/products-db";
import { toast } from "sonner";

export interface SeriesOptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  series: { id: string; name: string; category: string | null } | null;
  onChanged?: () => void;
}

interface OptionTypeRow {
  id: string;
  code: string;
  name_zh: string;
  sort_order: number;
}

interface OptionValueRow {
  id: string;
  option_type_id: string;
  code: string;
  name_zh: string;
  price_delta: number;
  sort_order: number;
}

interface AddFormState {
  open: boolean;
  code: string;
  name: string;
  delta: string;
  sort: string;
}

const EMPTY_ADD_FORM: AddFormState = { open: false, code: "", name: "", delta: "", sort: "" };

const inputCls =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const smallInputCls =
  "h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring";

function formatDelta(d: number): string {
  return d > 0 ? `+${d.toLocaleString()}` : d.toLocaleString();
}

function isDuplicateError(message: string | undefined): boolean {
  return /duplicate|23505|unique/i.test(String(message ?? ""));
}

/** 各選項軸的補充說明（依 option_types.code） */
const TYPE_HINTS: Record<string, string> = {
  size: "生成規格時輸入長寬會自動建檔到這裡",
  config: "系列專屬變化（抽屜、櫃體配置…）；代碼會直接接在規格代碼尾段",
};

/**
 * 系列選項設定：管理各選項軸（木種／尺寸／座墊／配置）的選項值、此系列提供哪些值，
 * 以及全域價差與此系列覆寫價差。價差只影響之後生成的規格，不回溯已生成規格。
 */
export function SeriesOptionsDialog({ open, onOpenChange, series, onChanged }: SeriesOptionsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [types, setTypes] = useState<OptionTypeRow[]>([]);
  const [values, setValues] = useState<OptionValueRow[]>([]);
  /** option_value_id → 覆寫價差（null＝沿用全域） */
  const [attached, setAttached] = useState<Record<string, number | null>>({});
  /** 此系列非刪除規格已使用的 option_value_id（禁止移除） */
  const [usedIds, setUsedIds] = useState<Set<string>>(new Set());
  /** 覆寫欄輸入草稿（字串，空＝沿用全域） */
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({});
  const [editingGlobalId, setEditingGlobalId] = useState<string | null>(null);
  const [globalDraft, setGlobalDraft] = useState("");
  const [addForms, setAddForms] = useState<Record<string, AddFormState>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!(open && series)) return;
    setLoading(true);
    setLoadError(null);
    setTypes([]);
    setValues([]);
    setAttached({});
    setUsedIds(new Set());
    setOverrideDrafts({});
    setEditingGlobalId(null);
    setAddForms({});

    let cancelled = false;
    (async () => {
      const [typesRes, valuesRes, optsRes, varsRes] = await Promise.all([
        supabase.from("option_types").select("id, code, name_zh, sort_order").order("sort_order"),
        supabase
          .from("option_values")
          .select("id, option_type_id, code, name_zh, price_delta, sort_order")
          .order("sort_order"),
        supabase
          .from("product_options")
          .select("option_value_id, price_delta_override")
          .eq("series_id", series.id),
        supabase
          .from(TABLE_PRODUCT_VARIANTS)
          .select("wood_value_id, size_value_id, cushion_value_id, config_value_id")
          .eq("series_id", series.id)
          .is("deleted_at", null),
      ]);
      if (cancelled) return;
      setLoading(false);
      const err = typesRes.error || valuesRes.error || optsRes.error || varsRes.error;
      if (err) {
        setLoadError(err.message || "讀取選項資料失敗");
        return;
      }
      setTypes((typesRes.data ?? []) as OptionTypeRow[]);
      setValues((valuesRes.data ?? []) as OptionValueRow[]);
      const map: Record<string, number | null> = {};
      const drafts: Record<string, string> = {};
      for (const row of optsRes.data ?? []) {
        map[row.option_value_id] = row.price_delta_override;
        drafts[row.option_value_id] =
          row.price_delta_override != null ? String(row.price_delta_override) : "";
      }
      setAttached(map);
      setOverrideDrafts(drafts);
      const used = new Set<string>();
      for (const v of varsRes.data ?? []) {
        if (v.wood_value_id) used.add(v.wood_value_id);
        if (v.size_value_id) used.add(v.size_value_id);
        if (v.cushion_value_id) used.add(v.cushion_value_id);
        if (v.config_value_id) used.add(v.config_value_id);
      }
      setUsedIds(used);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, series]);

  async function toggleAttach(v: OptionValueRow) {
    if (!series || busy) return;
    const isAttached = v.id in attached;
    setBusy(true);
    if (isAttached) {
      if (usedIds.has(v.id)) {
        setBusy(false);
        toast.error(`「${v.name_zh}」已被此系列的規格使用，無法移除`);
        return;
      }
      const { error } = await supabase
        .from("product_options")
        .delete()
        .eq("series_id", series.id)
        .eq("option_value_id", v.id);
      setBusy(false);
      if (error) {
        toast.error(error.message || "移除選項失敗");
        return;
      }
      setAttached((prev) => {
        const next = { ...prev };
        delete next[v.id];
        return next;
      });
      setOverrideDrafts((prev) => ({ ...prev, [v.id]: "" }));
    } else {
      const { error } = await supabase
        .from("product_options")
        .insert({ series_id: series.id, option_value_id: v.id });
      setBusy(false);
      if (error) {
        toast.error(error.message || "加入選項失敗");
        return;
      }
      setAttached((prev) => ({ ...prev, [v.id]: null }));
      setOverrideDrafts((prev) => ({ ...prev, [v.id]: "" }));
    }
    onChanged?.();
  }

  async function saveOverride(v: OptionValueRow) {
    if (!series) return;
    if (!(v.id in attached)) return;
    const current = attached[v.id];
    const raw = (overrideDrafts[v.id] ?? "").trim();
    let next: number | null = null;
    if (raw !== "") {
      const num = Number(raw);
      if (!Number.isInteger(num)) {
        toast.error("覆寫價差必須是整數");
        setOverrideDrafts((prev) => ({
          ...prev,
          [v.id]: current != null ? String(current) : "",
        }));
        return;
      }
      next = num;
    }
    if (next === current) return;
    const { error } = await supabase
      .from("product_options")
      .update({ price_delta_override: next })
      .eq("series_id", series.id)
      .eq("option_value_id", v.id);
    if (error) {
      toast.error(error.message || "儲存覆寫價差失敗");
      setOverrideDrafts((prev) => ({
        ...prev,
        [v.id]: current != null ? String(current) : "",
      }));
      return;
    }
    setAttached((prev) => ({ ...prev, [v.id]: next }));
    onChanged?.();
  }

  function startGlobalEdit(v: OptionValueRow) {
    setEditingGlobalId(v.id);
    setGlobalDraft(String(v.price_delta));
  }

  async function saveGlobal(v: OptionValueRow) {
    const num = Number(globalDraft.trim());
    if (globalDraft.trim() === "" || !Number.isInteger(num)) {
      toast.error("全域價差必須是整數");
      return;
    }
    if (num === v.price_delta) {
      setEditingGlobalId(null);
      return;
    }
    const { error } = await supabase
      .from("option_values")
      .update({ price_delta: num })
      .eq("id", v.id);
    if (error) {
      toast.error(error.message || "儲存全域價差失敗");
      return;
    }
    setValues((prev) => prev.map((x) => (x.id === v.id ? { ...x, price_delta: num } : x)));
    setEditingGlobalId(null);
    onChanged?.();
  }

  function setAddForm(typeId: string, patch: Partial<AddFormState>) {
    setAddForms((prev) => ({
      ...prev,
      [typeId]: { ...(prev[typeId] ?? EMPTY_ADD_FORM), ...patch },
    }));
  }

  async function submitAddValue(t: OptionTypeRow) {
    if (!series || busy) return;
    const form = addForms[t.id] ?? EMPTY_ADD_FORM;
    const code = form.code.trim();
    const name = form.name.trim();
    if (!code || !name) {
      toast.error("請輸入代碼與名稱");
      return;
    }
    let delta = 0;
    if (form.delta.trim() !== "") {
      const num = Number(form.delta.trim());
      if (!Number.isInteger(num)) {
        toast.error("全域價差必須是整數");
        return;
      }
      delta = num;
    }
    const typeValues = values.filter((v) => v.option_type_id === t.id);
    const defaultSort =
      (typeValues.length > 0 ? Math.max(...typeValues.map((v) => v.sort_order)) : 0) + 10;
    let sortOrder = defaultSort;
    if (form.sort.trim() !== "") {
      const num = Number(form.sort.trim());
      if (!Number.isInteger(num)) {
        toast.error("排序必須是整數");
        return;
      }
      sortOrder = num;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("option_values")
      .insert({
        option_type_id: t.id,
        code,
        name_zh: name,
        price_delta: delta,
        sort_order: sortOrder,
      })
      .select("id, option_type_id, code, name_zh, price_delta, sort_order")
      .single();
    if (error || !data) {
      setBusy(false);
      if (isDuplicateError(error?.message)) {
        toast.error(`「${t.name_zh}」已有代碼「${code}」的選項值，請改用其他代碼`);
      } else {
        toast.error(error?.message || "新增選項值失敗");
      }
      return;
    }
    const newValue = data as OptionValueRow;
    const { error: attachErr } = await supabase
      .from("product_options")
      .insert({ series_id: series.id, option_value_id: newValue.id });
    setBusy(false);
    setValues((prev) =>
      [...prev, newValue].sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
    );
    if (attachErr) {
      toast.warning(`選項值已建立，但加入此系列失敗：${attachErr.message}`);
    } else {
      setAttached((prev) => ({ ...prev, [newValue.id]: null }));
      setOverrideDrafts((prev) => ({ ...prev, [newValue.id]: "" }));
      toast.success(`已新增「${name}」並加入此系列`);
    }
    setAddForm(t.id, { ...EMPTY_ADD_FORM });
    onChanged?.();
  }

  if (!series) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="series-options-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">選項設定</Dialog.Title>
              <p id="series-options-desc" className="mt-1 text-sm text-muted-foreground">
                系列：{series.name || "未命名"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                勾選＝此系列提供該選項；覆寫留空＝沿用全域價差。
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

          <div className="mt-4 space-y-4">
            {loading && <p className="text-sm text-muted-foreground">載入選項資料中…</p>}
            {loadError && (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                {loadError}
              </p>
            )}
            {!loading && !loadError && types.length === 0 && (
              <p className="text-sm text-muted-foreground">尚未建立任何選項軸（option_types）。</p>
            )}
            {!loading &&
              !loadError &&
              types.map((t) => {
                const typeValues = values.filter((v) => v.option_type_id === t.id);
                const form = addForms[t.id] ?? EMPTY_ADD_FORM;
                return (
                  <section key={t.id} className="rounded-lg border border-border">
                    <div className="border-b border-border bg-muted/20 px-3 py-2">
                      <h3 className="text-xs font-semibold text-foreground">
                        {t.name_zh}
                        <span className="ml-1.5 font-normal text-muted-foreground">({t.code})</span>
                      </h3>
                      {TYPE_HINTS[t.code] && (
                        <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                          {TYPE_HINTS[t.code]}
                        </p>
                      )}
                    </div>
                    {typeValues.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">尚無選項值。</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {typeValues.map((v) => {
                          const isAttached = v.id in attached;
                          const editingGlobal = editingGlobalId === v.id;
                          return (
                            <li key={v.id} className="px-3 py-2">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                <label className="flex min-w-0 flex-1 basis-36 cursor-pointer items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={isAttached}
                                    onChange={() => toggleAttach(v)}
                                    disabled={busy}
                                    className="h-4 w-4 shrink-0 rounded border-input accent-primary"
                                    aria-label={`此系列提供 ${v.name_zh}`}
                                  />
                                  <span className="truncate text-sm text-foreground">
                                    {v.name_zh}
                                    <span className="ml-1 text-xs text-muted-foreground">({v.code})</span>
                                  </span>
                                </label>
                                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                                  <span>全域</span>
                                  {editingGlobal ? (
                                    <>
                                      <input
                                        type="number"
                                        value={globalDraft}
                                        onChange={(e) => setGlobalDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            e.preventDefault();
                                            saveGlobal(v);
                                          }
                                          if (e.key === "Escape") setEditingGlobalId(null);
                                        }}
                                        className={`${smallInputCls} w-20 text-right`}
                                        aria-label={`${v.name_zh} 全域價差`}
                                        autoFocus
                                      />
                                      <button
                                        type="button"
                                        onClick={() => saveGlobal(v)}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                                        aria-label="儲存全域價差"
                                      >
                                        <Check className="h-3.5 w-3.5 text-primary" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <span className="font-mono text-foreground">{formatDelta(v.price_delta)}</span>
                                      <button
                                        type="button"
                                        onClick={() => startGlobalEdit(v)}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                                        aria-label={`編輯 ${v.name_zh} 全域價差`}
                                        title="全域價差，影響所有未設覆寫的系列"
                                      >
                                        <Pencil className="h-3 w-3 text-muted-foreground" />
                                      </button>
                                    </>
                                  )}
                                </span>
                                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                                  <span>覆寫</span>
                                  <input
                                    type="number"
                                    value={overrideDrafts[v.id] ?? ""}
                                    onChange={(e) =>
                                      setOverrideDrafts((prev) => ({ ...prev, [v.id]: e.target.value }))
                                    }
                                    onBlur={() => saveOverride(v)}
                                    disabled={!isAttached}
                                    placeholder="沿用全域"
                                    className={`${smallInputCls} w-24 text-right disabled:cursor-not-allowed disabled:opacity-50`}
                                    aria-label={`${v.name_zh} 此系列覆寫價差`}
                                  />
                                </span>
                              </div>
                              {editingGlobal && (
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  全域價差，影響所有未設覆寫的系列。
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="border-t border-border px-3 py-2">
                      {form.open ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div className="flex flex-col gap-1">
                              <label htmlFor={`add-code-${t.id}`} className="text-[11px] text-muted-foreground">代碼 *</label>
                              <input
                                id={`add-code-${t.id}`}
                                type="text"
                                value={form.code}
                                onChange={(e) => setAddForm(t.id, { code: e.target.value })}
                                className={inputCls}
                                placeholder="例：OAK"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label htmlFor={`add-name-${t.id}`} className="text-[11px] text-muted-foreground">名稱 *</label>
                              <input
                                id={`add-name-${t.id}`}
                                type="text"
                                value={form.name}
                                onChange={(e) => setAddForm(t.id, { name: e.target.value })}
                                className={inputCls}
                                placeholder="例：白橡木"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label htmlFor={`add-delta-${t.id}`} className="text-[11px] text-muted-foreground">全域價差</label>
                              <input
                                id={`add-delta-${t.id}`}
                                type="number"
                                value={form.delta}
                                onChange={(e) => setAddForm(t.id, { delta: e.target.value })}
                                className={inputCls}
                                placeholder="0"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label htmlFor={`add-sort-${t.id}`} className="text-[11px] text-muted-foreground">排序</label>
                              <input
                                id={`add-sort-${t.id}`}
                                type="number"
                                value={form.sort}
                                onChange={(e) => setAddForm(t.id, { sort: e.target.value })}
                                className={inputCls}
                                placeholder="自動"
                              />
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              className="h-8 px-3 text-xs"
                              onClick={() => submitAddValue(t)}
                              disabled={busy}
                            >
                              新增並加入此系列
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-8 px-3 text-xs"
                              onClick={() => setAddForm(t.id, { ...EMPTY_ADD_FORM })}
                              disabled={busy}
                            >
                              取消
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAddForm(t.id, { open: true })}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          新增選項值
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">
              價差只影響之後生成的規格，已生成規格的定價不會回溯。
            </p>
            <Dialog.Close asChild>
              <Button type="button" variant="outline" className="h-8 px-3 text-xs">
                完成
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
