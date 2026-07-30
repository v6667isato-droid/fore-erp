"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ChevronDown, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PART_CATEGORIES, type BomLineType } from "@/types/inventory";
import { EXCLUSIVE_KEY_SUGGESTIONS } from "@/lib/part-variants";

interface SeriesOption {
  id: string;
  series_name: string;
}

/** 隨單材質線的目標候選：有材質軸的邏輯零件 */
interface AxisPartOption {
  id: string;
  name: string;
  series_id: string | null;
}

/** 固定零件線的目標候選：part_variant_stock_status 一列 */
interface VariantOption {
  id: string;
  part_id: string;
  sku: string;
  name: string;
  material_name: string | null;
  category: string;
  unit: string;
}

interface BomLineJoined {
  id: string;
  line_type: string;
  part_id: string | null;
  part_variant_id: string | null;
  quantity: number;
  unit: string | null;
  exclusive_group: string | null;
  exclusive_key: string | null;
  notes: string | null;
  parts: {
    name: string;
    name_code: string | null;
    category: string;
    unit: string;
    has_material_axis: boolean;
    deleted_at: string | null;
  } | null;
  part_variants: {
    sku: string;
    material_code: string | null;
    deleted_at: string | null;
    parts: { name: string; category: string; unit: string; deleted_at: string | null } | null;
  } | null;
}

export interface BomTabProps {
  isAdmin?: boolean;
}

/** 目標＋互斥代碼的唯一鍵：同鍵視為重複線 */
function lineDupKey(l: Pick<BomLineJoined, "line_type" | "part_id" | "part_variant_id" | "exclusive_key">): string {
  const target = l.line_type === "by_material" ? l.part_id : l.part_variant_id;
  return `${l.line_type}:${target ?? ""}:${l.exclusive_key ?? ""}`;
}

function lineCategory(l: BomLineJoined): string {
  return (l.line_type === "by_material" ? l.parts?.category : l.part_variants?.parts?.category) ?? "";
}

function lineUnit(l: BomLineJoined): string {
  return l.unit || (l.line_type === "by_material" ? l.parts?.unit : l.part_variants?.parts?.unit) || "—";
}

function lineTargetLabel(l: BomLineJoined): string {
  if (l.line_type === "by_material") return l.parts?.name ?? "（零件已刪除）";
  const v = l.part_variants;
  return v ? `${v.sku}｜${v.parts?.name ?? ""}` : "（變體已刪除）";
}

/** 維護系列層 BOM（bom_lines）：隨單材質線指邏輯零件、固定零件線指具體變體 */
export function BomTab({ isAdmin = false }: BomTabProps) {
  const [series, setSeries] = useState<SeriesOption[]>([]);
  const [axisParts, setAxisParts] = useState<AxisPartOption[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [seriesId, setSeriesId] = useState("");
  const [lines, setLines] = useState<BomLineJoined[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [deleteLine, setDeleteLine] = useState<BomLineJoined | null>(null);
  /** 每列用量的編輯值（key=bom_line id）；儲存於 blur */
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});

  // 加入 BOM 線的表單
  const [newLineType, setNewLineType] = useState<BomLineType>("by_material");
  const [newPartId, setNewPartId] = useState("");
  const [newVariantId, setNewVariantId] = useState("");
  /** 固定零件的篩選：分類＋關鍵字（SKU／名稱／材質） */
  const [newVariantCategory, setNewVariantCategory] = useState("");
  const [newVariantSearch, setNewVariantSearch] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newGroup, setNewGroup] = useState("");
  const [newKey, setNewKey] = useState("");

  // 從其他系列複製
  const [copySourceId, setCopySourceId] = useState("");
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [seriesRes, partsRes, variantsRes] = await Promise.all([
        supabase.from("product_series").select("id, series_name").is("deleted_at", null).order("series_name"),
        supabase
          .from("parts")
          .select("id, name, series_id")
          .eq("has_material_axis", true)
          .is("deleted_at", null)
          .order("name"),
        supabase
          .from("part_variant_stock_status")
          .select("id, part_id, sku, name, material_name, category, unit")
          .order("sku"),
      ]);
      if (cancelled) return;
      setSeries((seriesRes.data as SeriesOption[]) ?? []);
      setAxisParts((partsRes.data as AxisPartOption[]) ?? []);
      setVariants((variantsRes.data as unknown as VariantOption[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchLines = useCallback(async (sid: string) => {
    if (!sid) {
      setLines([]);
      return;
    }
    setLoadingLines(true);
    const { data, error } = await supabase
      .from("bom_lines")
      .select(
        "id, line_type, part_id, part_variant_id, quantity, unit, exclusive_group, exclusive_key, notes, " +
          "parts!part_id(name, name_code, category, unit, has_material_axis, deleted_at), " +
          "part_variants!part_variant_id(sku, material_code, deleted_at, parts!part_id(name, category, unit, deleted_at))",
      )
      .eq("series_id", sid)
      .order("created_at");
    setLoadingLines(false);
    if (error) {
      toast.error(error.message || "無法載入 BOM");
      setLines([]);
      return;
    }
    // 保險：目標零件／變體已軟刪除者不顯示（刪除時會連動清線，此處防殘留資料）
    setLines(
      (((data as unknown as BomLineJoined[]) ?? [])).filter((l) =>
        l.line_type === "by_material"
          ? l.parts != null && !l.parts.deleted_at
          : l.part_variants != null && !l.part_variants.deleted_at && !l.part_variants.parts?.deleted_at,
      ),
    );
    setQtyDrafts({});
  }, []);

  useEffect(() => {
    void fetchLines(seriesId);
  }, [seriesId, fetchLines]);

  /** 依目標零件分類分組，PART_CATEGORIES 順序在前、未知分類殿後 */
  const groups = useMemo(() => {
    const byCat = new Map<string, BomLineJoined[]>();
    for (const l of lines) {
      const cat = lineCategory(l) || "其他";
      const list = byCat.get(cat) ?? [];
      list.push(l);
      byCat.set(cat, list);
    }
    const ordered: [string, BomLineJoined[]][] = [];
    for (const cat of PART_CATEGORIES) {
      const list = byCat.get(cat);
      if (list) {
        ordered.push([cat, list]);
        byCat.delete(cat);
      }
    }
    for (const [cat, list] of byCat) ordered.push([cat, list]);
    return ordered;
  }, [lines]);

  const existingKeys = useMemo(() => new Set(lines.map(lineDupKey)), [lines]);

  const addablePartOptions = useMemo(
    () => axisParts.filter((p) => p.series_id === seriesId || p.series_id == null),
    [axisParts, seriesId],
  );

  const addableVariantOptions = useMemo(() => {
    const q = newVariantSearch.trim().toLowerCase();
    return variants.filter((v) => {
      if (newVariantCategory && v.category !== newVariantCategory) return false;
      if (!q) return true;
      return (
        v.sku.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        (v.material_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [variants, newVariantCategory, newVariantSearch]);

  // 篩選改變後，已選變體若被濾掉就清空選擇
  useEffect(() => {
    if (newVariantId && !addableVariantOptions.some((v) => v.id === newVariantId)) {
      setNewVariantId("");
    }
  }, [addableVariantOptions, newVariantId]);

  const seriesNameById = useMemo(() => new Map(series.map((s) => [s.id, s.series_name])), [series]);

  function toggleGroup(cat: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  async function addLine() {
    if (!seriesId) return;
    const targetId = newLineType === "by_material" ? newPartId : newVariantId;
    if (!targetId) return;
    const qty = Number(newQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("用量必須大於 0");
      return;
    }
    const key = lineDupKey({
      line_type: newLineType,
      part_id: newLineType === "by_material" ? targetId : null,
      part_variant_id: newLineType === "fixed" ? targetId : null,
      exclusive_key: newKey.trim() || null,
    });
    if (existingKeys.has(key)) {
      toast.error("相同目標與互斥代碼的線已存在，未重複加入");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("bom_lines").insert({
      series_id: seriesId,
      line_type: newLineType,
      part_id: newLineType === "by_material" ? targetId : null,
      part_variant_id: newLineType === "fixed" ? targetId : null,
      quantity: qty,
      exclusive_group: newGroup.trim() || null,
      exclusive_key: newKey.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "加入失敗");
      return;
    }
    setNewPartId("");
    setNewVariantId("");
    setNewQty("1");
    setNewGroup("");
    setNewKey("");
    void fetchLines(seriesId);
  }

  async function saveQty(line: BomLineJoined) {
    const raw = qtyDrafts[line.id];
    if (raw == null) return;
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("用量必須大於 0");
      setQtyDrafts((d) => ({ ...d, [line.id]: String(line.quantity) }));
      return;
    }
    if (qty === Number(line.quantity)) return;
    const { error } = await supabase.from("bom_lines").update({ quantity: qty }).eq("id", line.id);
    if (error) {
      toast.error(error.message || "更新用量失敗");
      return;
    }
    void fetchLines(seriesId);
  }

  async function performDelete() {
    if (!deleteLine) return;
    const id = deleteLine.id;
    setDeleteLine(null);
    const { error } = await supabase.from("bom_lines").delete().eq("id", id);
    if (error) {
      toast.error(error.message || "刪除失敗");
      return;
    }
    void fetchLines(seriesId);
  }

  async function performCopy() {
    setCopyConfirmOpen(false);
    if (!seriesId || !copySourceId) return;
    setBusy(true);
    const { data: sourceRows, error } = await supabase
      .from("bom_lines")
      .select("line_type, part_id, part_variant_id, quantity, unit, exclusive_group, exclusive_key, notes")
      .eq("series_id", copySourceId);
    if (error) {
      setBusy(false);
      toast.error(error.message || "無法讀取來源 BOM");
      return;
    }
    const toInsert = (sourceRows ?? [])
      .filter((r) => !existingKeys.has(lineDupKey(r)))
      .map((r) => ({
        series_id: seriesId,
        line_type: r.line_type,
        part_id: r.part_id,
        part_variant_id: r.part_variant_id,
        quantity: r.quantity,
        unit: r.unit,
        exclusive_group: r.exclusive_group,
        exclusive_key: r.exclusive_key,
        notes: r.notes,
      }));
    if (toInsert.length === 0) {
      setBusy(false);
      toast.info("來源沒有可複製的線（皆已存在或來源為空）");
      return;
    }
    const { error: insErr } = await supabase.from("bom_lines").insert(toInsert);
    setBusy(false);
    if (insErr) {
      toast.error(insErr.message || "複製失敗");
      return;
    }
    toast.success(`已複製 ${toInsert.length} 條 BOM 線`);
    setCopySourceId("");
    void fetchLines(seriesId);
  }

  const inputCls =
    "h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
  const badgeCls = "rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground whitespace-nowrap";
  const copySourceSeries = series.find((s) => s.id === copySourceId);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        每個產品系列維護一份用料表；「隨單材質」線依訂單木種自動對應零件變體，「固定零件」線直接指定變體，工單開工時依此自動扣帳。
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="flex min-w-[14rem] flex-col gap-1.5">
          <label htmlFor="bom-series" className="text-xs text-muted-foreground">產品系列</label>
          <select
            id="bom-series"
            value={seriesId}
            onChange={(e) => setSeriesId(e.target.value)}
            className={inputCls}
          >
            <option value="">選擇系列…</option>
            {series.map((s) => (
              <option key={s.id} value={s.id}>{s.series_name}</option>
            ))}
          </select>
        </div>
        {isAdmin && seriesId && (
          <div className="flex flex-col gap-1.5 sm:ml-auto">
            <label htmlFor="bom-copy-source" className="text-xs text-muted-foreground">從其他系列複製</label>
            <div className="flex flex-wrap gap-2">
              <select
                id="bom-copy-source"
                value={copySourceId}
                onChange={(e) => setCopySourceId(e.target.value)}
                className={cn(inputCls, "min-w-[12rem]")}
              >
                <option value="">選擇來源系列…</option>
                {series
                  .filter((s) => s.id !== seriesId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.series_name}</option>
                  ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="h-9 shrink-0"
                disabled={!copySourceId || busy}
                onClick={() => setCopyConfirmOpen(true)}
              >
                <Copy className="h-4 w-4 mr-1" />
                複製
              </Button>
            </div>
          </div>
        )}
      </div>

      {seriesId ? (
        <>
          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            {loadingLines ? (
              <div className="p-8 text-center text-sm text-muted-foreground" role="status">載入 BOM 中…</div>
            ) : lines.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                此系列尚未建立用料{isAdmin ? "，請在下方加入 BOM 線" : ""}
              </div>
            ) : (
              groups.map(([cat, groupLines]) => {
                const isCollapsed = collapsed.has(cat);
                return (
                  <div key={cat} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => toggleGroup(cat)}
                      aria-expanded={!isCollapsed}
                      className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-semibold text-foreground hover:bg-muted/30"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
                      )}
                      {cat}（{groupLines.length} 條）
                    </button>
                    {!isCollapsed &&
                      groupLines.map((l) => (
                        <div
                          key={l.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 hover:bg-muted/30 sm:pl-9"
                        >
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                            {l.line_type === "by_material" ? (
                              <>
                                <span className="text-sm font-medium text-foreground">{l.parts?.name ?? "（零件已刪除）"}</span>
                                <span className={cn(badgeCls, "border-transparent bg-primary/10 text-primary")}>隨單材質</span>
                              </>
                            ) : (
                              <>
                                <span className="text-sm font-medium text-foreground whitespace-nowrap">{l.part_variants?.sku ?? "—"}</span>
                                <span className="text-sm text-foreground">{l.part_variants?.parts?.name ?? "（零件已刪除）"}</span>
                                <span className={badgeCls}>{l.part_variants?.material_code ?? "無材質"}</span>
                              </>
                            )}
                            {l.exclusive_group && (
                              <span className={cn(badgeCls, "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400")}>
                                {l.exclusive_group}：{l.exclusive_key ?? "—"}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {isAdmin ? (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={qtyDrafts[l.id] ?? String(l.quantity)}
                                onChange={(e) => setQtyDrafts((d) => ({ ...d, [l.id]: e.target.value }))}
                                onBlur={() => void saveQty(l)}
                                className="h-8 w-20 rounded-lg border border-input bg-background px-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                aria-label={`${lineTargetLabel(l)} 用量`}
                              />
                            ) : (
                              <span className="text-sm tabular-nums">{l.quantity}</span>
                            )}
                            <span className="w-8 text-sm text-muted-foreground">{lineUnit(l)}</span>
                            {isAdmin && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeleteLine(l)}
                                aria-label={`移除 ${lineTargetLabel(l)}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                );
              })
            )}
          </div>

          {isAdmin && (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
              <div className="inline-flex w-fit rounded-lg border border-input p-0.5" role="tablist" aria-label="BOM 線類型">
                {(
                  [
                    ["by_material", "隨單材質"],
                    ["fixed", "固定零件"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={newLineType === value}
                    onClick={() => setNewLineType(value)}
                    className={cn(
                      "h-8 rounded-md px-3 text-sm transition-colors",
                      newLineType === value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {newLineType === "by_material" ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="bom-new-part" className="text-xs text-muted-foreground">邏輯零件（依訂單木種對應變體）</label>
                  <select id="bom-new-part" value={newPartId} onChange={(e) => setNewPartId(e.target.value)} className={inputCls}>
                    <option value="">選擇零件…（{addablePartOptions.length} 顆符合）</option>
                    {addablePartOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}（{p.series_id ? seriesNameById.get(p.series_id) ?? "?" : "共用"}）
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="bom-variant-filter-category" className="text-xs text-muted-foreground">篩選分類</label>
                    <select
                      id="bom-variant-filter-category"
                      value={newVariantCategory}
                      onChange={(e) => setNewVariantCategory(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">全部分類</option>
                      {PART_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="bom-variant-filter-search" className="text-xs text-muted-foreground">篩選零件</label>
                    <input
                      id="bom-variant-filter-search"
                      type="search"
                      value={newVariantSearch}
                      onChange={(e) => setNewVariantSearch(e.target.value)}
                      placeholder="搜尋 SKU、名稱、材質…"
                      className={inputCls}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label htmlFor="bom-new-variant" className="text-xs text-muted-foreground">零件變體</label>
                    <select id="bom-new-variant" value={newVariantId} onChange={(e) => setNewVariantId(e.target.value)} className={inputCls}>
                      <option value="">選擇變體…（{addableVariantOptions.length} 顆符合）</option>
                      {addableVariantOptions.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.sku}｜{v.name}
                          {v.material_name ? `・${v.material_name}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="bom-new-qty" className="text-xs text-muted-foreground">用量</label>
                  <input
                    id="bom-new-qty"
                    type="number"
                    min="0"
                    step="any"
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    className={cn(inputCls, "text-right")}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="bom-new-group" className="text-xs text-muted-foreground">互斥群組（選填）</label>
                  <input
                    id="bom-new-group"
                    type="text"
                    value={newGroup}
                    onChange={(e) => setNewGroup(e.target.value)}
                    placeholder="例如：seat"
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="bom-new-key" className="text-xs text-muted-foreground">互斥代碼（選填）</label>
                  <input
                    id="bom-new-key"
                    type="text"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    list="bom-exclusive-key-suggestions"
                    placeholder="F / W / P…"
                    className={inputCls}
                  />
                  <datalist id="bom-exclusive-key-suggestions">
                    {EXCLUSIVE_KEY_SUGGESTIONS.map((s) => (
                      <option key={s.key} value={s.key}>{`${s.key}（${s.label}）`}</option>
                    ))}
                  </datalist>
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    className="h-9"
                    disabled={busy || (newLineType === "by_material" ? !newPartId : !newVariantId)}
                    onClick={() => void addLine()}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    加入
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">同群組內依訂單座墊代碼只取一條；空＝一律列入。</p>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          選擇產品系列後顯示其用料表
        </div>
      )}

      <ConfirmDialog
        open={copyConfirmOpen}
        onOpenChange={setCopyConfirmOpen}
        title="是否複製此系列的用料表？"
        description={
          copySourceSeries ? (
            <>
              <p className="font-medium text-foreground">{copySourceSeries.series_name}</p>
              <p className="mt-2 text-muted-foreground text-sm">
                來源的 BOM 線會加入目前系列；相同目標與互斥代碼的線會略過、不覆蓋用量。隨單材質線引用的是邏輯零件，跨系列共用同一顆部件時才適用，複製後請逐條確認。
              </p>
            </>
          ) : null
        }
        confirmLabel="確定複製"
        onConfirm={performCopy}
      />

      <ConfirmDialog
        open={deleteLine != null}
        onOpenChange={(open) => !open && setDeleteLine(null)}
        title="是否自用料表移除此 BOM 線？"
        description={
          deleteLine ? (
            <p className="font-medium text-foreground">
              {lineTargetLabel(deleteLine)}
              {deleteLine.line_type === "by_material" ? "（隨單材質）" : ""}
            </p>
          ) : null
        }
        confirmLabel="確定移除"
        onConfirm={performDelete}
        destructive
      />
    </div>
  );
}
