"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import {
  TABLE_PRODUCT_SERIES,
  TABLE_PRODUCT_VARIANTS,
  WOOD_TYPE_OPTIONS,
} from "@/lib/products-db";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { SeriesRow } from "@/types/products";
import type { TablesInsert } from "@/types/database.types";
import { seriesCodeFromName } from "@/types/inventory";
import { DEFAULT_SEAT_HEIGHT_CM } from "@/lib/product-seat-height";

export interface AddVariantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  series: SeriesRow | null;
  onSuccess: () => void;
}

/** 選項軸代碼（對應 option_types.code 與 product_variants 的 *_value_id 欄位） */
const AXIS_CODES = ["wood", "size", "cushion"] as const;
type AxisCode = (typeof AXIS_CODES)[number];

interface AxisValue {
  id: string;
  code: string;
  name_zh: string;
  price_delta: number;
  sort_order: number;
}

interface AxisGroup {
  typeCode: AxisCode;
  typeName: string;
  typeSortOrder: number;
  values: AxisValue[];
}

/** product_options join option_values join option_types 的查詢回傳列 */
interface ProductOptionJoinRow {
  option_values: {
    id: string;
    code: string;
    name_zh: string;
    price_delta: number;
    sort_order: number;
    option_types: { code: string; name_zh: string; sort_order: number } | null;
  } | null;
}

interface Combo {
  wood: AxisValue | null;
  size: AxisValue | null;
  cushion: AxisValue | null;
  code: string;
  price: number | null;
  exists: boolean;
}

function comboKey(woodId: string | null, sizeId: string | null, cushionId: string | null): string {
  return `${woodId ?? ""}|${sizeId ?? ""}|${cushionId ?? ""}`;
}

const inputCls =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function AddVariantDialog({ open, onOpenChange, series, onSuccess }: AddVariantDialogProps) {
  const firstRef = useRef<HTMLInputElement>(null);
  // 手動輸入模式欄位（維持原行為）
  const [code, setCode] = useState("");
  const [woodType, setWoodType] = useState("");
  const [w, setW] = useState("");
  const [d, setD] = useState("");
  const [h, setH] = useState("");
  const [price, setPrice] = useState("");
  const [spec1, setSpec1] = useState("");
  const [seatHeightCm, setSeatHeightCm] = useState("");
  const [isCustomOrder, setIsCustomOrder] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 勾選生成模式
  const [mode, setMode] = useState<"generate" | "manual">("manual");
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [axes, setAxes] = useState<AxisGroup[]>([]);
  const [basePrice, setBasePrice] = useState<number | null>(null);
  const [existingCombos, setExistingCombos] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Record<AxisCode, Set<string>>>({
    wood: new Set(),
    size: new Set(),
    cushion: new Set(),
  });
  const [genCustom, setGenCustom] = useState(false);

  useEffect(() => {
    if (!(open && series)) return;
    setCode("");
    setWoodType("");
    setW("");
    setD("");
    setH("");
    setPrice("");
    setSpec1("");
    setIsCustomOrder(false);
    setSeatHeightCm(
      series.category === "椅" || series.category === "凳"
        ? String(DEFAULT_SEAT_HEIGHT_CM)
        : ""
    );
    setError(null);
    setMode("manual");
    setAxes([]);
    setBasePrice(null);
    setExistingCombos(new Set());
    setSelected({ wood: new Set(), size: new Set(), cushion: new Set() });
    setGenCustom(false);

    let cancelled = false;
    (async () => {
      setLoadingOptions(true);
      const [optRes, seriesRes, varRes] = await Promise.all([
        supabase
          .from("product_options")
          .select(
            "option_values(id, code, name_zh, price_delta, sort_order, option_types(code, name_zh, sort_order))"
          )
          .eq("series_id", series.id),
        supabase
          .from(TABLE_PRODUCT_SERIES)
          .select("base_price")
          .eq("id", series.id)
          .maybeSingle(),
        supabase
          .from(TABLE_PRODUCT_VARIANTS)
          .select("wood_value_id, size_value_id, cushion_value_id, is_custom_order")
          .eq("series_id", series.id)
          .is("deleted_at", null),
      ]);
      if (cancelled) return;
      setLoadingOptions(false);
      if (optRes.error || seriesRes.error || varRes.error) {
        // 選項載入失敗時退回手動輸入，不阻擋原流程
        setMode("manual");
        return;
      }
      const rows = (optRes.data ?? []) as unknown as ProductOptionJoinRow[];
      const groups = new Map<AxisCode, AxisGroup>();
      for (const row of rows) {
        const v = row.option_values;
        const t = v?.option_types;
        if (!v || !t) continue;
        const axisCode = AXIS_CODES.find((c) => c === t.code);
        if (!axisCode) continue;
        let g = groups.get(axisCode);
        if (!g) {
          g = { typeCode: axisCode, typeName: t.name_zh, typeSortOrder: t.sort_order, values: [] };
          groups.set(axisCode, g);
        }
        g.values.push({
          id: v.id,
          code: v.code,
          name_zh: v.name_zh,
          price_delta: v.price_delta,
          sort_order: v.sort_order,
        });
      }
      const axisList = Array.from(groups.values())
        .sort((a, b) => a.typeSortOrder - b.typeSortOrder)
        .map((g) => ({
          ...g,
          values: g.values.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code)),
        }));
      setAxes(axisList);
      setBasePrice(
        typeof seriesRes.data?.base_price === "number" ? seriesRes.data.base_price : null
      );
      const existing = new Set<string>();
      for (const v of varRes.data ?? []) {
        if (v.is_custom_order) continue;
        if (!v.wood_value_id && !v.size_value_id && !v.cushion_value_id) continue;
        existing.add(comboKey(v.wood_value_id, v.size_value_id, v.cushion_value_id));
      }
      setExistingCombos(existing);
      if (axisList.length > 0) setMode("generate");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, series]);

  useEffect(() => {
    if (open && mode === "manual" && firstRef.current)
      setTimeout(() => firstRef.current?.focus(), 0);
  }, [open, mode]);

  const seriesCode = series ? seriesCodeFromName(series.name) : "";

  const combos = useMemo<Combo[]>(() => {
    if (axes.length === 0) return [];
    const pick = (axisCode: AxisCode): (AxisValue | null)[] => {
      const axis = axes.find((a) => a.typeCode === axisCode);
      if (!axis) return [null];
      const chosen = axis.values.filter((v) => selected[axisCode].has(v.id));
      return chosen.length > 0 ? chosen : [null];
    };
    const woods = pick("wood");
    const sizes = pick("size");
    const cushions = pick("cushion");
    const list: Combo[] = [];
    for (const wood of woods) {
      for (const size of sizes) {
        for (const cushion of cushions) {
          if (!wood && !size && !cushion) continue;
          const segCode = [seriesCode, wood?.code, size?.code, cushion?.code]
            .filter((s): s is string => Boolean(s))
            .join("-");
          const delta =
            (wood?.price_delta ?? 0) + (size?.price_delta ?? 0) + (cushion?.price_delta ?? 0);
          list.push({
            wood,
            size,
            cushion,
            code: genCustom ? `${segCode}-C` : segCode,
            price: basePrice == null ? null : basePrice + delta,
            exists:
              !genCustom &&
              existingCombos.has(comboKey(wood?.id ?? null, size?.id ?? null, cushion?.id ?? null)),
          });
        }
      }
    }
    return list;
  }, [axes, selected, seriesCode, basePrice, existingCombos, genCustom]);

  const newCombos = combos.filter((c) => !c.exists);
  const skippedCount = combos.length - newCombos.length;

  function toggleValue(axisCode: AxisCode, valueId: string) {
    setSelected((prev) => {
      const next = new Set(prev[axisCode]);
      if (next.has(valueId)) next.delete(valueId);
      else next.add(valueId);
      return { ...prev, [axisCode]: next };
    });
  }

  async function submitManual() {
    if (!series) return;
    if (!code.trim()) {
      setError("請輸入產品代碼");
      return;
    }
    setAdding(true);
    const payload: Record<string, unknown> = {
      series_id: series.id,
      product_code: code.trim(),
      wood_type: woodType.trim() || null,
      dimension_w: w.trim() ? Number(w) : null,
      dimension_d: d.trim() ? Number(d) : null,
      dimension_h: h.trim() ? Number(h) : null,
      base_price: price.trim() ? Number(price) : null,
      is_custom_order: isCustomOrder,
    };
    payload.spec1 = spec1.trim() || null;
    const showSeatHeight = series.category === "椅" || series.category === "凳";
    if (showSeatHeight) {
      payload.seat_height_cm = seatHeightCm.trim() ? Number(seatHeightCm) : null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 動態組裝欄位，欄位集合因環境而異
    const { error: err } = await supabase.from(TABLE_PRODUCT_VARIANTS).insert(payload as any);
    setAdding(false);
    if (err) {
      toast.error(err.message || "新增規格失敗");
      setError(err.message || "新增規格失敗");
      return;
    }
    toast.success("已新增規格");
    onOpenChange(false);
    onSuccess();
  }

  async function submitGenerate() {
    if (!series) return;
    if (basePrice == null) {
      setError("此系列未設基礎價，無法自動計價");
      return;
    }
    if (newCombos.length === 0) {
      setError(combos.length > 0 ? "勾選的組合皆已存在" : "請先勾選要生成的選項");
      return;
    }
    setAdding(true);
    const showSeatHeight = series.category === "椅" || series.category === "凳";
    const rows: TablesInsert<"product_variants">[] = newCombos.map((c) => ({
      series_id: series.id,
      product_code: c.code,
      wood_type: c.wood?.name_zh ?? null,
      spec1: c.cushion ? `${c.cushion.name_zh}-${c.cushion.code}` : null,
      base_price: c.price,
      wood_value_id: c.wood?.id ?? null,
      size_value_id: c.size?.id ?? null,
      cushion_value_id: c.cushion?.id ?? null,
      is_custom_order: genCustom,
      ...(showSeatHeight ? { seat_height_cm: DEFAULT_SEAT_HEIGHT_CM } : {}),
    }));
    const { error: err } = await supabase.from(TABLE_PRODUCT_VARIANTS).insert(rows);
    setAdding(false);
    if (err) {
      toast.error(err.message || "生成規格失敗");
      setError(err.message || "生成規格失敗");
      return;
    }
    toast.success(
      skippedCount > 0
        ? `生成 ${newCombos.length} 列，略過 ${skippedCount} 列已存在`
        : `生成 ${newCombos.length} 列`
    );
    onOpenChange(false);
    onSuccess();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "generate") await submitGenerate();
    else await submitManual();
  }

  if (!series) return null;

  const hasOptions = axes.length > 0;
  const generateDisabled = adding || basePrice == null || newCombos.length === 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg focus:outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-describedby="add-variant-desc"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">新增規格</Dialog.Title>
              <p id="add-variant-desc" className="mt-1 text-sm text-muted-foreground">系列：{series.name}</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="關閉">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </Dialog.Close>
          </div>
          {loadingOptions && (
            <p className="mt-4 text-sm text-muted-foreground">載入選項中…</p>
          )}
          {!loadingOptions && hasOptions && (
            <div className="mt-4 inline-flex flex-wrap gap-1 rounded-lg border border-border bg-muted/20 p-1" role="tablist" aria-label="新增模式">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "generate"}
                onClick={() => { setMode("generate"); setError(null); }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring ${mode === "generate" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                勾選生成
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "manual"}
                onClick={() => { setMode("manual"); setError(null); }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring ${mode === "manual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                手動輸入
              </button>
            </div>
          )}
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            {mode === "generate" && hasOptions ? (
              <>
                {axes.map((axis) => (
                  <fieldset key={axis.typeCode} className="flex flex-col gap-1.5">
                    <legend className="text-xs text-muted-foreground">{axis.typeName}</legend>
                    <div className="flex flex-wrap gap-2">
                      {axis.values.map((v) => {
                        const checked = selected[axis.typeCode].has(v.id);
                        return (
                          <label
                            key={v.id}
                            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${checked ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleValue(axis.typeCode, v.id)}
                              className="h-3.5 w-3.5 rounded border-input accent-primary"
                            />
                            <span>
                              {v.name_zh}（{v.code}
                              {v.price_delta !== 0 && (
                                <>，{v.price_delta > 0 ? `+${v.price_delta}` : v.price_delta}</>
                              )}
                              ）
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
                {basePrice == null ? (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                    此系列未設基礎價，無法自動計價；請先於編輯系列設定基礎價後再生成。
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    基礎價 NT$ {basePrice.toLocaleString()}，定價＝基礎價＋各選項加價自動計算；代碼與定價唯讀。
                  </p>
                )}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    預覽（共 {combos.length} 列，新增 {newCombos.length} 列
                    {skippedCount > 0 && `，略過 ${skippedCount} 列已存在`}）
                  </span>
                  {combos.length === 0 ? (
                    <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      請勾選上方選項以產生組合
                    </p>
                  ) : (
                    <ul className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                      {combos.map((c) => (
                        <li
                          key={c.code}
                          className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-1.5 text-xs ${c.exists ? "text-muted-foreground/60" : "text-foreground"}`}
                        >
                          <span className="font-mono">{c.code}</span>
                          <span className="flex items-center gap-2">
                            <span>{c.price == null ? "未設基礎價" : `NT$ ${c.price.toLocaleString()}`}</span>
                            {c.exists && (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">已存在，略過</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={genCustom}
                    onChange={(e) => setGenCustom(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-foreground">訂製款（開單佔位用）</span>
                    <span className="text-[11px] text-muted-foreground">代碼加 -C 結尾；不列入產品介紹表／價目表；新增訂單選到時牌價改為手動輸入</span>
                  </span>
                </label>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="add-variant-code" className="text-xs text-muted-foreground">產品代碼 *</label>
                  <input ref={firstRef} id="add-variant-code" type="text" value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} required />
                  {series.code_rule?.trim() && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      編碼原則：{series.code_rule.trim()}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="add-variant-wood" className="text-xs text-muted-foreground">木種</label>
                  <input
                    id="add-variant-wood"
                    type="text"
                    list="add-variant-wood-list"
                    value={woodType}
                    onChange={(e) => setWoodType(e.target.value)}
                    className={inputCls}
                    placeholder="例：白橡木"
                  />
                  <datalist id="add-variant-wood-list">
                    {WOOD_TYPE_OPTIONS.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="add-variant-w" className="text-xs text-muted-foreground">寬 W（cm）</label>
                    <input id="add-variant-w" type="number" value={w} onChange={(e) => setW(e.target.value)} className={inputCls} placeholder="cm" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="add-variant-d" className="text-xs text-muted-foreground">深 D（cm）</label>
                    <input id="add-variant-d" type="number" value={d} onChange={(e) => setD(e.target.value)} className={inputCls} placeholder="cm" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="add-variant-h" className="text-xs text-muted-foreground">高 H（cm）</label>
                    <input id="add-variant-h" type="number" value={h} onChange={(e) => setH(e.target.value)} className={inputCls} placeholder="cm" />
                  </div>
                </div>
                {(series.category === "椅" || series.category === "凳") && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="add-variant-seat-h" className="text-xs text-muted-foreground">座高（cm）</label>
                    <input
                      id="add-variant-seat-h"
                      type="number"
                      value={seatHeightCm}
                      onChange={(e) => setSeatHeightCm(e.target.value)}
                      className={inputCls}
                      placeholder={`預設 ${DEFAULT_SEAT_HEIGHT_CM}cm，座面離地高度`}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="add-variant-price" className="text-xs text-muted-foreground">基礎定價</label>
                  <input id="add-variant-price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} placeholder="元" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="add-variant-spec1" className="text-xs text-muted-foreground">規格 1</label>
                  {series.category === "椅" ? (
                    <select
                      id="add-variant-spec1"
                      value={spec1}
                      onChange={(e) => setSpec1(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">—</option>
                      <option value="紙繩-P">紙繩-P</option>
                      <option value="藤編-R">藤編-R</option>
                      <option value="實木-W">實木-W</option>
                      <option value="布墊-F">布墊-F</option>
                    </select>
                  ) : (
                    <input
                      id="add-variant-spec1"
                      type="text"
                      value={spec1}
                      onChange={(e) => setSpec1(e.target.value)}
                      className={inputCls}
                      placeholder="可自訂此類別的第一個規格"
                    />
                  )}
                </div>
                <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isCustomOrder}
                    onChange={(e) => setIsCustomOrder(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-foreground">訂製款（開單佔位用）</span>
                    <span className="text-[11px] text-muted-foreground">代碼慣例加 -C 結尾；不列入產品介紹表／價目表；新增訂單選到時牌價改為手動輸入</span>
                  </span>
                </label>
              </>
            )}
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild><Button type="button" variant="ghost" disabled={adding}>取消</Button></Dialog.Close>
              {mode === "generate" && hasOptions ? (
                <Button type="submit" disabled={generateDisabled}>
                  {adding ? "生成中…" : `生成 ${newCombos.length} 列規格`}
                </Button>
              ) : (
                <Button type="submit" disabled={adding}>{adding ? "新增中…" : "新增規格"}</Button>
              )}
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
