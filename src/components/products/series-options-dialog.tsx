"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { X, Pencil, Plus, Trash2 } from "lucide-react";
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

interface EditFormState {
  code: string;
  name: string;
  delta: string;
  sort: string;
}

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
  /** 正在整筆編輯的 option_value_id（代碼／名稱／全域價差／排序） */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditFormState>({ code: "", name: "", delta: "", sort: "" });
  const [addForms, setAddForms] = useState<Record<string, AddFormState>>({});
  const [busy, setBusy] = useState(false);
  /** 系列基礎價草稿（字串；空＝未設定）；生成規格的定價＝基礎價＋Σ有效價差 */
  const [basePriceDraft, setBasePriceDraft] = useState("");
  const [basePriceSaved, setBasePriceSaved] = useState("");

  useEffect(() => {
    if (!(open && series)) return;
    setLoading(true);
    setLoadError(null);
    setTypes([]);
    setValues([]);
    setAttached({});
    setUsedIds(new Set());
    setOverrideDrafts({});
    setEditingId(null);
    setAddForms({});

    let cancelled = false;
    (async () => {
      const [typesRes, valuesRes, optsRes, varsRes, seriesRes] = await Promise.all([
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
        supabase.from("product_series").select("base_price").eq("id", series.id).single(),
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
      const bp = (seriesRes.data as { base_price: number | null } | null)?.base_price;
      setBasePriceDraft(bp != null ? String(bp) : "");
      setBasePriceSaved(bp != null ? String(bp) : "");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, series]);

  async function saveBasePrice() {
    if (!series) return;
    const t = basePriceDraft.trim();
    if (t === basePriceSaved) return;
    const n = t === "" ? null : Math.round(Number(t));
    if (t !== "" && (!Number.isFinite(n as number) || (n as number) < 0)) {
      toast.error("基礎價需為 0 以上的整數");
      setBasePriceDraft(basePriceSaved);
      return;
    }
    const { error } = await supabase
      .from("product_series")
      .update({ base_price: n })
      .eq("id", series.id);
    if (error) {
      toast.error(error.message || "基礎價儲存失敗");
      setBasePriceDraft(basePriceSaved);
      return;
    }
    setBasePriceSaved(t === "" ? "" : String(n));
    setBasePriceDraft(t === "" ? "" : String(n));
    toast.success(n == null ? "已清除基礎價" : `基礎價已更新為 ${n.toLocaleString()}`);
    onChanged?.();
  }

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

  function startEdit(v: OptionValueRow) {
    setEditingId(v.id);
    setEditDraft({
      code: v.code,
      name: v.name_zh,
      delta: String(v.price_delta),
      sort: String(v.sort_order),
    });
  }

  async function saveEdit(v: OptionValueRow, typeName: string) {
    if (busy) return;
    const code = editDraft.code.trim();
    const name = editDraft.name.trim();
    if (!code || !name) {
      toast.error("請輸入代碼與名稱");
      return;
    }
    const delta = Number(editDraft.delta.trim());
    if (editDraft.delta.trim() === "" || !Number.isInteger(delta)) {
      toast.error("全域價差必須是整數");
      return;
    }
    const sort = Number(editDraft.sort.trim());
    if (editDraft.sort.trim() === "" || !Number.isInteger(sort)) {
      toast.error("排序必須是整數");
      return;
    }
    if (
      code === v.code &&
      name === v.name_zh &&
      delta === v.price_delta &&
      sort === v.sort_order
    ) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("option_values")
      .update({ code, name_zh: name, price_delta: delta, sort_order: sort })
      .eq("id", v.id);
    setBusy(false);
    if (error) {
      if (isDuplicateError(error.message)) {
        toast.error(`「${typeName}」已有代碼「${code}」的選項值，請改用其他代碼`);
      } else {
        toast.error(error.message || "儲存選項值失敗");
      }
      return;
    }
    setValues((prev) =>
      prev
        .map((x) =>
          x.id === v.id ? { ...x, code, name_zh: name, price_delta: delta, sort_order: sort } : x
        )
        .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
    );
    setEditingId(null);
    toast.success(`已更新「${name}」`);
    onChanged?.();
  }

  async function deleteValue(v: OptionValueRow) {
    if (!series || busy) return;
    if (usedIds.has(v.id)) {
      toast.error(`「${v.name_zh}」已被此系列的規格使用，無法刪除`);
      return;
    }
    if (
      !window.confirm(
        `確定刪除選項值「${v.name_zh} (${v.code})」？\n刪除後所有系列都無法再選用此值，且無法復原。`
      )
    )
      return;
    setBusy(true);
    // 先確認沒有其他系列的規格或選項設定引用，避免刪到一半被外鍵擋下
    const [varsRes, optsRes] = await Promise.all([
      supabase
        .from(TABLE_PRODUCT_VARIANTS)
        .select("id", { count: "exact", head: true })
        .or(
          `wood_value_id.eq.${v.id},size_value_id.eq.${v.id},cushion_value_id.eq.${v.id},config_value_id.eq.${v.id}`
        ),
      supabase
        .from("product_options")
        .select("series_id", { count: "exact", head: true })
        .eq("option_value_id", v.id)
        .neq("series_id", series.id),
    ]);
    if (varsRes.error || optsRes.error) {
      setBusy(false);
      toast.error(varsRes.error?.message || optsRes.error?.message || "檢查引用狀態失敗");
      return;
    }
    if ((varsRes.count ?? 0) > 0) {
      setBusy(false);
      toast.error(`「${v.name_zh}」已被規格使用（含其他系列），無法刪除`);
      return;
    }
    if ((optsRes.count ?? 0) > 0) {
      setBusy(false);
      toast.error(`「${v.name_zh}」已被其他系列的選項設定選用，無法刪除`);
      return;
    }
    if (v.id in attached) {
      const { error: detachErr } = await supabase
        .from("product_options")
        .delete()
        .eq("series_id", series.id)
        .eq("option_value_id", v.id);
      if (detachErr) {
        setBusy(false);
        toast.error(detachErr.message || "移除系列選項失敗");
        return;
      }
    }
    const { error } = await supabase.from("option_values").delete().eq("id", v.id);
    setBusy(false);
    if (error) {
      toast.error(error.message || "刪除選項值失敗");
      return;
    }
    setValues((prev) => prev.filter((x) => x.id !== v.id));
    setAttached((prev) => {
      const next = { ...prev };
      delete next[v.id];
      return next;
    });
    setEditingId(null);
    toast.success(`已刪除「${v.name_zh}」`);
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

          {!loading && !loadError && (
            <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <div className="flex flex-col gap-1">
                <label htmlFor="series-base-price" className="text-xs font-medium text-foreground">
                  系列基礎價
                </label>
                <input
                  id="series-base-price"
                  type="number"
                  min="0"
                  step="1"
                  value={basePriceDraft}
                  onChange={(e) => setBasePriceDraft(e.target.value)}
                  onBlur={() => void saveBasePrice()}
                  className={`${inputCls} w-36 text-right tabular-nums`}
                  placeholder="未設定"
                />
              </div>
              <p className="pb-1 text-[11px] leading-snug text-muted-foreground">
                生成規格的定價＝基礎價＋Σ選項價差（預覽時仍可逐列修改）。
                未設基礎價的系列無法使用勾選生成。改基礎價不回溯已生成規格。
              </p>
            </div>
          )}

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
                          const isEditing = editingId === v.id;
                          if (isEditing) {
                            return (
                              <li key={v.id} className="px-3 py-2">
                                <div className="space-y-2">
                                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                    <div className="flex flex-col gap-1">
                                      <label htmlFor={`edit-code-${v.id}`} className="text-[11px] text-muted-foreground">代碼 *</label>
                                      <input
                                        id={`edit-code-${v.id}`}
                                        type="text"
                                        value={editDraft.code}
                                        onChange={(e) => setEditDraft((prev) => ({ ...prev, code: e.target.value }))}
                                        className={inputCls}
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <label htmlFor={`edit-name-${v.id}`} className="text-[11px] text-muted-foreground">名稱 *</label>
                                      <input
                                        id={`edit-name-${v.id}`}
                                        type="text"
                                        value={editDraft.name}
                                        onChange={(e) => setEditDraft((prev) => ({ ...prev, name: e.target.value }))}
                                        className={inputCls}
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <label htmlFor={`edit-delta-${v.id}`} className="text-[11px] text-muted-foreground">全域價差</label>
                                      <input
                                        id={`edit-delta-${v.id}`}
                                        type="number"
                                        value={editDraft.delta}
                                        onChange={(e) => setEditDraft((prev) => ({ ...prev, delta: e.target.value }))}
                                        className={inputCls}
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <label htmlFor={`edit-sort-${v.id}`} className="text-[11px] text-muted-foreground">排序</label>
                                      <input
                                        id={`edit-sort-${v.id}`}
                                        type="number"
                                        value={editDraft.sort}
                                        onChange={(e) => setEditDraft((prev) => ({ ...prev, sort: e.target.value }))}
                                        className={inputCls}
                                      />
                                    </div>
                                  </div>
                                  <p className="text-[11px] text-muted-foreground">
                                    改代碼／名稱／價差不會回溯已生成規格的編號與定價。全域價差影響所有未設覆寫的系列。
                                  </p>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                      type="button"
                                      className="h-8 px-3 text-xs"
                                      onClick={() => saveEdit(v, t.name_zh)}
                                      disabled={busy}
                                    >
                                      儲存
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      className="h-8 px-3 text-xs"
                                      onClick={() => setEditingId(null)}
                                      disabled={busy}
                                    >
                                      取消
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      className="ml-auto h-8 px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                                      onClick={() => deleteValue(v)}
                                      disabled={busy || usedIds.has(v.id)}
                                      title={usedIds.has(v.id) ? "已被此系列的規格使用，無法刪除" : "刪除此選項值（所有系列）"}
                                    >
                                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                                      刪除
                                    </Button>
                                  </div>
                                </div>
                              </li>
                            );
                          }
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
                                  <span className="font-mono text-foreground">{formatDelta(v.price_delta)}</span>
                                  <button
                                    type="button"
                                    onClick={() => startEdit(v)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                                    aria-label={`編輯 ${v.name_zh}`}
                                    title="編輯代碼／名稱／全域價差／排序"
                                  >
                                    <Pencil className="h-3 w-3 text-muted-foreground" />
                                  </button>
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
