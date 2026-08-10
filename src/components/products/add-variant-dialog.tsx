"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import {
  TABLE_PRODUCT_SERIES,
  TABLE_PRODUCT_VARIANTS,
} from "@/lib/products-db";
import { useWoodTypeOptions } from "@/lib/use-wood-type-options";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import type { SeriesRow } from "@/types/products";
import type { TablesInsert } from "@/types/database.types";
import { seriesCodeFromName } from "@/types/inventory";
import { DEFAULT_SEAT_HEIGHT_CM, hasSeatSpecs } from "@/lib/product-seat-height";

export interface AddVariantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  series: SeriesRow | null;
  onSuccess: () => void;
}

/** 選項軸代碼（對應 option_types.code 與 product_variants 的 *_value_id 欄位） */
const AXIS_CODES = ["wood", "size", "cushion", "config"] as const;
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
  price_delta_override: number | null;
  option_values: {
    id: string;
    code: string;
    name_zh: string;
    price_delta: number;
    sort_order: number;
    option_types: { code: string; name_zh: string; sort_order: number } | null;
  } | null;
}

/** 生成批次中的尺寸選擇：既有選項值（id 非空）或本批新輸入尺寸（id 為 null，生成時建檔） */
interface SizeSel {
  id: string | null;
  code: string;
  price_delta: number;
  w: number | null;
  d: number | null;
  h: number | null;
}

interface Combo {
  wood: AxisValue | null;
  size: SizeSel | null;
  cushion: AxisValue | null;
  config: AxisValue | null;
  code: string;
  price: number | null;
  exists: boolean;
}

function comboKey(
  woodId: string | null,
  sizeKey: string | null,
  cushionId: string | null,
  configId: string | null
): string {
  return `${woodId ?? ""}|${sizeKey ?? ""}|${cushionId ?? ""}|${configId ?? ""}`;
}

function isDupComboError(message: string | undefined): boolean {
  return /duplicate|23505|unique/i.test(String(message ?? ""));
}

/** 從尺寸代碼反推寬深高（W{w}D{d}H{h}、W{w}D{d}、W{w}H{h} 或純數字＝僅寬），無法解析回傳 null */
function parseSizeCode(code: string): { w: number | null; d: number | null; h: number | null } {
  const m = /^W(\d+(?:\.\d+)?)(?:D(\d+(?:\.\d+)?))?(?:H(\d+(?:\.\d+)?))?$/i.exec(code);
  if (m) {
    return {
      w: Number(m[1]),
      d: m[2] != null ? Number(m[2]) : null,
      h: m[3] != null ? Number(m[3]) : null,
    };
  }
  const wOnly = /^\d+(?:\.\d+)?$/.exec(code);
  if (wOnly) return { w: Number(code), d: null, h: null };
  return { w: null, d: null, h: null };
}

const inputCls =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function AddVariantDialog({ open, onOpenChange, series, onSuccess }: AddVariantDialogProps) {
  const firstRef = useRef<HTMLInputElement>(null);
  const woodTypeOptions = useWoodTypeOptions(open);
  // 手動輸入模式欄位（維持原行為）
  const [code, setCode] = useState("");
  const [woodType, setWoodType] = useState("");
  const [w, setW] = useState("");
  const [d, setD] = useState("");
  const [h, setH] = useState("");
  const [price, setPrice] = useState("");
  const [spec1, setSpec1] = useState("");
  const [seatHeightCm, setSeatHeightCm] = useState("");
  const [armHeightCmInput, setArmHeightCmInput] = useState("");
  const [isCustomOrder, setIsCustomOrder] = useState(false);
  const [showOnSheet, setShowOnSheet] = useState(false);
  const [showOnPriceList, setShowOnPriceList] = useState(false);
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
    config: new Set(),
  });
  const [genCustom, setGenCustom] = useState(false);
  /** 預覽逐列手動調價（key＝comboKey，value＝輸入字串；空字串＝用自動計價） */
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  /** 本批新輸入的尺寸（生成時 find-or-create option_values 並掛入此系列） */
  const [newSizes, setNewSizes] = useState<
    { code: string; w: number; d: number | null; h: number | null }[]
  >([]);
  const [sizeW, setSizeW] = useState("");
  const [sizeD, setSizeD] = useState("");
  const [sizeH, setSizeH] = useState("");
  /** 本批統一套用的尺寸（無尺寸軸時提供寬深高；有尺寸軸時僅高） */
  const [batchW, setBatchW] = useState("");
  const [batchD, setBatchD] = useState("");
  const [batchH, setBatchH] = useState("");
  /** 預覽中被使用者移除的組合（key＝comboEditKey） */
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());

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
    setShowOnSheet(false);
    setShowOnPriceList(false);
    setSeatHeightCm(hasSeatSpecs(series.category) ? String(DEFAULT_SEAT_HEIGHT_CM) : "");
    setArmHeightCmInput("");
    setError(null);
    setMode("manual");
    setAxes([]);
    setBasePrice(null);
    setExistingCombos(new Set());
    setSelected({ wood: new Set(), size: new Set(), cushion: new Set(), config: new Set() });
    setGenCustom(false);
    setPriceEdits({});
    setNewSizes([]);
    setSizeW("");
    setSizeD("");
    setSizeH("");
    setBatchW("");
    setBatchD("");
    setBatchH("");
    setRemovedKeys(new Set());

    let cancelled = false;
    (async () => {
      setLoadingOptions(true);
      const [optRes, seriesRes, varRes] = await Promise.all([
        supabase
          .from("product_options")
          .select(
            "price_delta_override, option_values(id, code, name_zh, price_delta, sort_order, option_types(code, name_zh, sort_order))"
          )
          .eq("series_id", series.id),
        supabase
          .from(TABLE_PRODUCT_SERIES)
          .select("base_price")
          .eq("id", series.id)
          .maybeSingle(),
        supabase
          .from(TABLE_PRODUCT_VARIANTS)
          .select("wood_value_id, size_value_id, cushion_value_id, config_value_id, is_custom_order")
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
          // 有效價差＝此系列覆寫（product_options.price_delta_override）優先，否則用全域價差
          price_delta: row.price_delta_override ?? v.price_delta,
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
        if (!v.wood_value_id && !v.size_value_id && !v.cushion_value_id && !v.config_value_id)
          continue;
        existing.add(
          comboKey(v.wood_value_id, v.size_value_id, v.cushion_value_id, v.config_value_id)
        );
      }
      setExistingCombos(existing);
      if (axisList.length > 0) setMode("generate");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, series]);

  // 勾選／尺寸清單變動重新產生組合時，重設逐列手動調價與移除記錄
  useEffect(() => {
    setPriceEdits({});
    setRemovedKeys(new Set());
  }, [selected, genCustom, newSizes]);

  useEffect(() => {
    if (open && mode === "manual" && firstRef.current)
      setTimeout(() => firstRef.current?.focus(), 0);
  }, [open, mode]);

  const seriesCode = series ? seriesCodeFromName(series.name) : "";

  const combos = useMemo<Combo[]>(() => {
    const pick = (axisCode: AxisCode): (AxisValue | null)[] => {
      const axis = axes.find((a) => a.typeCode === axisCode);
      if (!axis) return [null];
      const chosen = axis.values.filter((v) => selected[axisCode].has(v.id));
      return chosen.length > 0 ? chosen : [null];
    };
    const woods = pick("wood");
    const cushions = pick("cushion");
    const configs = pick("config");
    // 尺寸清單＝已勾選的既有尺寸檔＋本批新輸入尺寸
    const sizeAxis = axes.find((a) => a.typeCode === "size");
    const sizeSels: SizeSel[] = [
      ...(sizeAxis?.values ?? [])
        .filter((v) => selected.size.has(v.id))
        .map((v) => ({
          id: v.id,
          code: v.code,
          price_delta: v.price_delta,
          ...parseSizeCode(v.code),
        })),
      ...newSizes.map((s) => ({ id: null, code: s.code, price_delta: 0, w: s.w, d: s.d, h: s.h })),
    ];
    const sizes: (SizeSel | null)[] = sizeSels.length > 0 ? sizeSels : [null];
    const list: Combo[] = [];
    for (const wood of woods) {
      for (const size of sizes) {
        for (const cushion of cushions) {
          for (const config of configs) {
            if (!wood && !size && !cushion && !config) continue;
            const segCode = [seriesCode, wood?.code, size?.code, cushion?.code, config?.code]
              .filter((s): s is string => Boolean(s))
              .join("-");
            const delta =
              (wood?.price_delta ?? 0) +
              (size?.price_delta ?? 0) +
              (cushion?.price_delta ?? 0) +
              (config?.price_delta ?? 0);
            list.push({
              wood,
              size,
              cushion,
              config,
              code: genCustom ? `${segCode}-C` : segCode,
              price: basePrice == null ? null : basePrice + delta,
              exists:
                !genCustom &&
                // 新輸入尺寸還沒有 option_value id，必為新組合
                !(size != null && size.id == null) &&
                existingCombos.has(
                  comboKey(
                    wood?.id ?? null,
                    size?.id ?? null,
                    cushion?.id ?? null,
                    config?.id ?? null
                  )
                ),
            });
          }
        }
      }
    }
    return list;
  }, [axes, selected, newSizes, seriesCode, basePrice, existingCombos, genCustom]);

  const visibleCombos = combos.filter((c) => !removedKeys.has(comboEditKey(c)));
  const removedCount = combos.length - visibleCombos.length;
  const newCombos = visibleCombos.filter((c) => !c.exists);
  const skippedCount = visibleCombos.length - newCombos.length;
  /** 尚未有有效定價（正整數）的新增列數；未設基礎價時需逐列輸入 */
  const missingPriceCount = newCombos.filter((c) => {
    const p = effectivePrice(c);
    return p == null || p <= 0;
  }).length;

  function comboEditKey(c: Combo): string {
    return comboKey(
      c.wood?.id ?? null,
      c.size ? (c.size.id ?? `new:${c.size.code}`) : null,
      c.cushion?.id ?? null,
      c.config?.id ?? null
    );
  }

  /** 該列最終寫入的定價：有手動輸入取整數輸入值，否則用自動計價 */
  function effectivePrice(c: Combo): number | null {
    const raw = (priceEdits[comboEditKey(c)] ?? "").trim();
    if (raw !== "") {
      const num = Number(raw);
      if (Number.isFinite(num)) return Math.round(num);
    }
    return c.price;
  }

  /** 預覽列的中文組成說明：木種・尺寸・坐墊・構型，價差非 0 附（+N） */
  function comboLabel(c: Combo): string {
    const fmt = (name: string, delta: number) =>
      delta === 0
        ? name
        : `${name}（${delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}）`;
    const parts: string[] = [];
    if (c.wood) parts.push(fmt(c.wood.name_zh, c.wood.price_delta));
    if (c.size) parts.push(fmt(c.size.code, c.size.price_delta));
    if (c.cushion) parts.push(fmt(c.cushion.name_zh, c.cushion.price_delta));
    if (c.config) parts.push(fmt(c.config.name_zh, c.config.price_delta));
    return parts.join("・");
  }

  /** 批次尺寸輸入轉數值（空字串或非正數＝不套用） */
  function batchDim(s: string): number | null {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function toggleValue(axisCode: AxisCode, valueId: string) {
    setSelected((prev) => {
      const next = new Set(prev[axisCode]);
      if (next.has(valueId)) next.delete(valueId);
      else next.add(valueId);
      return { ...prev, [axisCode]: next };
    });
  }

  /** 把輸入的寬深高加入本批尺寸清單；代碼撞到既有尺寸檔時改為直接勾選 */
  function addNewSize() {
    const wNum = Number(sizeW.trim());
    if (sizeW.trim() === "" || !Number.isFinite(wNum) || wNum <= 0) {
      toast.error("請輸入寬（正數，cm）");
      return;
    }
    let dNum: number | null = null;
    if (sizeD.trim() !== "") {
      const n = Number(sizeD.trim());
      if (!Number.isFinite(n) || n <= 0) {
        toast.error("深必須是正數（cm）");
        return;
      }
      dNum = n;
    }
    let hNum: number | null = null;
    if (sizeH.trim() !== "") {
      const n = Number(sizeH.trim());
      if (!Number.isFinite(n) || n <= 0) {
        toast.error("高必須是正數（cm）");
        return;
      }
      hNum = n;
    }
    const codeStr =
      dNum != null || hNum != null
        ? `W${wNum}${dNum != null ? `D${dNum}` : ""}${hNum != null ? `H${hNum}` : ""}`
        : String(wNum);
    const sizeAxis = axes.find((a) => a.typeCode === "size");
    const existing = sizeAxis?.values.find((v) => v.code === codeStr);
    if (existing) {
      setSelected((prev) =>
        prev.size.has(existing.id)
          ? prev
          : { ...prev, size: new Set(prev.size).add(existing.id) }
      );
      toast.info(`尺寸 ${codeStr} 已有選項檔，已為您勾選`);
    } else if (newSizes.some((s) => s.code === codeStr)) {
      toast.info(`尺寸 ${codeStr} 已在本批清單`);
    } else {
      setNewSizes((prev) => [...prev, { code: codeStr, w: wNum, d: dNum, h: hNum }]);
    }
    setSizeW("");
    setSizeD("");
    setSizeH("");
  }

  function removeNewSize(codeStr: string) {
    setNewSizes((prev) => prev.filter((s) => s.code !== codeStr));
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
      show_on_sheet: showOnSheet,
      show_on_price_list: showOnPriceList,
    };
    payload.spec1 = spec1.trim() || null;
    const showSeatHeight = hasSeatSpecs(series.category);
    if (showSeatHeight) {
      payload.seat_height_cm = seatHeightCm.trim() ? Number(seatHeightCm) : null;
      // 扶手高度無預設：留空即不寫入，訂單／產品資料表也不會顯示
      payload.arm_height_cm = armHeightCmInput.trim() ? Number(armHeightCmInput) : null;
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
    if (newCombos.length === 0) {
      setError(combos.length > 0 ? "勾選的組合皆已存在或已移除" : "請先勾選要生成的選項");
      return;
    }
    if (missingPriceCount > 0) {
      setError("請為每列填入定價");
      return;
    }
    setAdding(true);
    // 新輸入尺寸先 find-or-create option_values（type=size，以代碼比對）並掛入此系列
    const usedNewCodes = new Set<string>();
    for (const c of newCombos) {
      if (c.size && c.size.id == null) usedNewCodes.add(c.size.code);
    }
    const sizeIdByCode = new Map<string, string>();
    if (usedNewCodes.size > 0) {
      const typeRes = await supabase
        .from("option_types")
        .select("id")
        .eq("code", "size")
        .maybeSingle();
      if (typeRes.error || !typeRes.data) {
        setAdding(false);
        const msg = typeRes.error?.message || "找不到尺寸選項軸（option_types code=size）";
        toast.error(msg);
        setError(msg);
        return;
      }
      const sizeTypeId = typeRes.data.id;
      for (const codeStr of usedNewCodes) {
        const found = await supabase
          .from("option_values")
          .select("id")
          .eq("option_type_id", sizeTypeId)
          .eq("code", codeStr)
          .maybeSingle();
        if (found.error) {
          setAdding(false);
          toast.error(found.error.message || "查詢尺寸選項失敗");
          setError(found.error.message || "查詢尺寸選項失敗");
          return;
        }
        let valueId = found.data?.id ?? null;
        if (!valueId) {
          const sizeEntry = newSizes.find((s) => s.code === codeStr);
          const ins = await supabase
            .from("option_values")
            .insert({
              option_type_id: sizeTypeId,
              code: codeStr,
              name_zh: codeStr,
              price_delta: 0,
              sort_order: Math.round(sizeEntry?.w ?? 0),
            })
            .select("id")
            .single();
          if (ins.error || !ins.data) {
            setAdding(false);
            const msg = ins.error?.message || `建立尺寸選項 ${codeStr} 失敗`;
            toast.error(msg);
            setError(msg);
            return;
          }
          valueId = ins.data.id;
        }
        sizeIdByCode.set(codeStr, valueId);
        const attach = await supabase
          .from("product_options")
          .insert({ series_id: series.id, option_value_id: valueId });
        // 已掛入此系列（unique 衝突）視為成功，其餘錯誤中止
        if (attach.error && !/duplicate|23505|unique/i.test(attach.error.message)) {
          setAdding(false);
          toast.error(attach.error.message || `尺寸 ${codeStr} 掛入系列失敗`);
          setError(attach.error.message || `尺寸 ${codeStr} 掛入系列失敗`);
          return;
        }
      }
    }
    const showSeatHeight = hasSeatSpecs(series.category);
    const rows: TablesInsert<"product_variants">[] = newCombos.map((c) => ({
      series_id: series.id,
      product_code: c.code,
      wood_type: c.wood?.name_zh ?? null,
      spec1: c.cushion ? `${c.cushion.name_zh}-${c.cushion.code}` : null,
      base_price: effectivePrice(c),
      wood_value_id: c.wood?.id ?? null,
      size_value_id: c.size ? (c.size.id ?? sizeIdByCode.get(c.size.code) ?? null) : null,
      cushion_value_id: c.cushion?.id ?? null,
      config_value_id: c.config?.id ?? null,
      // 尺寸來源：尺寸碼有的維度取尺寸碼，缺的維度退回本批統一輸入
      dimension_w: c.size?.w ?? batchDim(batchW),
      dimension_d: c.size?.d ?? batchDim(batchD),
      dimension_h: c.size?.h ?? batchDim(batchH),
      is_custom_order: genCustom,
      ...(showSeatHeight ? { seat_height_cm: DEFAULT_SEAT_HEIGHT_CM } : {}),
    }));
    const { error: err } = await supabase.from(TABLE_PRODUCT_VARIANTS).insert(rows);
    setAdding(false);
    if (err) {
      const msg = isDupComboError(err.message)
        ? "部分組合已存在（可能前一輪已生成），請重新開啟視窗後再試"
        : err.message || "生成規格失敗";
      toast.error(msg);
      setError(msg);
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

  // 非椅類（桌／櫃／層架／其他…）一律開放生成模式並提供自由尺寸輸入；椅類維持原行為
  const isNonChair = series.category !== "椅";
  const sizeAxis = axes.find((a) => a.typeCode === "size");
  const showSizeBlock = isNonChair || Boolean(sizeAxis);
  const hasOptions = axes.length > 0 || isNonChair;
  const generateDisabled = adding || newCombos.length === 0 || missingPriceCount > 0;

  const axisCheckbox = (axisCode: AxisCode, v: AxisValue) => {
    const checked = selected[axisCode].has(v.id);
    return (
      <label
        key={v.id}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${checked ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggleValue(axisCode, v.id)}
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
  };

  const sizeBlock = (
    <fieldset key="axis-size" className="flex flex-col gap-1.5">
      <legend className="text-xs text-muted-foreground">{sizeAxis?.typeName ?? "尺寸"}</legend>
      {sizeAxis && sizeAxis.values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sizeAxis.values.map((v) => axisCheckbox("size", v))}
        </div>
      )}
      {newSizes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {newSizes.map((s) => (
            <span
              key={s.code}
              className="inline-flex items-center gap-1 rounded-lg border border-primary bg-primary/10 px-2.5 py-1 text-xs text-foreground"
            >
              <span className="font-mono">{s.code}</span>
              <span className="text-[10px] text-muted-foreground">新</span>
              <button
                type="button"
                onClick={() => removeNewSize(s.code)}
                className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label={`移除尺寸 ${s.code}`}
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="gen-size-w" className="text-[11px] text-muted-foreground">寬 W（cm）*</label>
          <input
            id="gen-size-w"
            type="number"
            value={sizeW}
            onChange={(e) => setSizeW(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addNewSize();
              }
            }}
            className={`${inputCls} w-24`}
            placeholder="必填"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="gen-size-d" className="text-[11px] text-muted-foreground">深 D（cm）</label>
          <input
            id="gen-size-d"
            type="number"
            value={sizeD}
            onChange={(e) => setSizeD(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addNewSize();
              }
            }}
            className={`${inputCls} w-24`}
            placeholder="選填"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="gen-size-h" className="text-[11px] text-muted-foreground">高 H（cm）</label>
          <input
            id="gen-size-h"
            type="number"
            value={sizeH}
            onChange={(e) => setSizeH(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addNewSize();
              }
            }}
            className={`${inputCls} w-24`}
            placeholder="選填"
          />
        </div>
        <Button type="button" variant="outline" className="h-9 px-3 text-xs" onClick={addNewSize}>
          加入尺寸
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="gen-batch-d" className="text-[11px] text-muted-foreground">深 D（cm，尺寸碼未含時套用到本批）</label>
          <input
            id="gen-batch-d"
            type="number"
            value={batchD}
            onChange={(e) => setBatchD(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            className={`${inputCls} w-24`}
            placeholder="選填"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="gen-batch-h" className="text-[11px] text-muted-foreground">高 H（cm，尺寸碼未含時套用到本批）</label>
          <input
            id="gen-batch-h"
            type="number"
            value={batchH}
            onChange={(e) => setBatchH(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            className={`${inputCls} w-24`}
            placeholder="選填"
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        輸入寬深高按「加入尺寸」加入本批；生成時自動建檔為尺寸選項並掛入此系列。
        代碼：寬＋深＋高 → W180D48H180，寬＋深 → W60D35，僅寬 → 60。
        勾選的既有尺寸檔代碼缺深／高時，用上方「套用到本批」欄位補寫。
      </p>
    </fieldset>
  );

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
                {(() => {
                  // 尺寸軸以擴充區塊（勾選＋自由輸入）呈現，其餘軸維持一般勾選；未掛尺寸軸時按排序插入尺寸區塊
                  const items = axes.map((axis) => ({
                    sort: axis.typeSortOrder,
                    node:
                      axis.typeCode === "size" && showSizeBlock ? (
                        sizeBlock
                      ) : (
                        <fieldset key={axis.typeCode} className="flex flex-col gap-1.5">
                          <legend className="text-xs text-muted-foreground">{axis.typeName}</legend>
                          <div className="flex flex-wrap gap-2">
                            {axis.values.map((v) => axisCheckbox(axis.typeCode, v))}
                          </div>
                        </fieldset>
                      ),
                  }));
                  if (showSizeBlock && !sizeAxis) items.push({ sort: 2, node: sizeBlock });
                  return items.sort((a, b) => a.sort - b.sort).map((i) => i.node);
                })()}
                {!showSizeBlock && (
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="text-xs text-muted-foreground">尺寸（cm，選填，套用到本批）</legend>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-1">
                        <label htmlFor="gen-batch-dim-w" className="text-[11px] text-muted-foreground">寬 W</label>
                        <input
                          id="gen-batch-dim-w"
                          type="number"
                          value={batchW}
                          onChange={(e) => setBatchW(e.target.value)}
                          className={`${inputCls} w-24`}
                          placeholder="選填"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="gen-batch-dim-d" className="text-[11px] text-muted-foreground">深 D</label>
                        <input
                          id="gen-batch-dim-d"
                          type="number"
                          value={batchD}
                          onChange={(e) => setBatchD(e.target.value)}
                          className={`${inputCls} w-24`}
                          placeholder="選填"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor="gen-batch-dim-h" className="text-[11px] text-muted-foreground">高 H</label>
                        <input
                          id="gen-batch-dim-h"
                          type="number"
                          value={batchH}
                          onChange={(e) => setBatchH(e.target.value)}
                          className={`${inputCls} w-24`}
                          placeholder="選填"
                        />
                      </div>
                    </div>
                  </fieldset>
                )}
                {basePrice == null ? (
                  <p className="text-[11px] text-muted-foreground">
                    未設基礎價：請直接於預覽逐列輸入定價（或到選項設定填基礎價自動計價）。
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    基礎價 NT$ {basePrice.toLocaleString()}，定價＝基礎價＋各選項加價自動計算，可於預覽逐列修改；代碼唯讀。
                  </p>
                )}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    預覽（共 {visibleCombos.length} 列，新增 {newCombos.length} 列
                    {skippedCount > 0 && `，略過 ${skippedCount} 列已存在`}
                    {removedCount > 0 && `，已移除 ${removedCount} 列`}）
                  </span>
                  {visibleCombos.length === 0 ? (
                    <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      {combos.length > 0 ? "所有組合已移除，請調整勾選重新產生" : "請勾選上方選項以產生組合"}
                    </p>
                  ) : (
                    <ul className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                      {visibleCombos.map((c) => {
                        const editKey = comboEditKey(c);
                        return (
                          <li
                            key={c.code}
                            className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-1.5 text-xs ${c.exists ? "text-muted-foreground/60" : "text-foreground"}`}
                          >
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="font-mono">{c.code}</span>
                              <span className="text-xs text-muted-foreground break-words">{comboLabel(c)}</span>
                            </span>
                            <span className="flex items-center gap-2">
                              {c.exists ? (
                                <>
                                  <span>{c.price == null ? "—" : `NT$ ${c.price.toLocaleString()}`}</span>
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">已存在，略過</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-muted-foreground">NT$</span>
                                  <input
                                    type="number"
                                    value={priceEdits[editKey] ?? (c.price == null ? "" : String(c.price))}
                                    onChange={(e) =>
                                      setPriceEdits((prev) => ({ ...prev, [editKey]: e.target.value }))
                                    }
                                    className="h-7 w-24 rounded-md border border-input bg-background px-2 text-right text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                                    aria-label={`定價 ${c.code}`}
                                    placeholder={c.price == null ? "輸入定價" : undefined}
                                  />
                                </>
                              )}
                              {!c.exists && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRemovedKeys((prev) => {
                                      const next = new Set(prev);
                                      next.add(editKey);
                                      return next;
                                    })
                                  }
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
                                  aria-label={`移除組合 ${c.code}`}
                                  title="從本批生成移除"
                                >
                                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {missingPriceCount > 0 && (
                    <p className="text-[11px] text-destructive">請為每列填入定價</p>
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
                    {woodTypeOptions.map((o) => (
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
                {hasSeatSpecs(series.category) && (
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
                {hasSeatSpecs(series.category) && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="add-variant-arm-h" className="text-xs text-muted-foreground">扶手高度 AH（cm）</label>
                    <input
                      id="add-variant-arm-h"
                      type="number"
                      value={armHeightCmInput}
                      onChange={(e) => setArmHeightCmInput(e.target.value)}
                      className={inputCls}
                      placeholder="無扶手請留空，留空則各處不顯示"
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
                    checked={showOnSheet}
                    onChange={(e) => setShowOnSheet(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-foreground">顯示於產品介紹表</span>
                    <span className="text-[11px] text-muted-foreground">勾選後此規格會出現在介紹表第二頁；尺寸線圖可於「修改規格」上傳</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showOnPriceList}
                    onChange={(e) => setShowOnPriceList(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-foreground">顯示於價目表</span>
                    <span className="text-[11px] text-muted-foreground">勾選後此規格會出現在對外價目表（與介紹表勾選各自獨立）</span>
                  </span>
                </label>
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
