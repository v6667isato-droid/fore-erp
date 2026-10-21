import { describe, expect, it } from "vitest";
import {
  AXIS_NONE,
  axisValuesOf,
  buildSteps,
  choicesOf,
  pendingStepTitle,
  pickAxisValue,
  searchVariants,
  splitSeriesVariants,
  type AxisValueInfo,
  type StepVariant,
  type VariantAxis,
} from "@/lib/variant-steps";

function val(axis: VariantAxis, code: string, name: string, sort: number): AxisValueInfo {
  return { id: `${axis}:${code}`, axis, code, name, sort };
}

// 取材自實際選項值主檔
const O = val("wood", "O", "白橡木", 1);
const SO = val("wood", "SO", "煙燻白橡木", 2);
const W = val("wood", "W", "胡桃木", 3);
const T = val("wood", "T", "柚木", 4);
const WG = val("wood", "Wenge", "雞翅木", 5);
const F = val("cushion", "F", "布墊", 1);
const P = val("cushion", "P", "紙繩", 2);
const L = val("cushion", "L", "皮墊", 5);
const S150H90 = val("size", "W150D45H90", "150H90", 1);
const S180 = val("size", "W180D42H45", "180", 2);
const S180H90 = val("size", "W180D45H90", "180H90", 3);
const S190 = val("size", "W190D42.5H52", "190", 4);
const S60 = val("size", "W60D50H60", "W60D50H60", 5);
const MD = val("config", "MD", "抽屜置中", 1);

function v(
  id: string,
  seriesId: string,
  code: string,
  axis: Partial<Record<VariantAxis, AxisValueInfo>> | null,
  opts: Partial<StepVariant> = {},
): StepVariant {
  return {
    id,
    series_id: seriesId,
    product_code: code,
    label: code,
    base_price: 1000,
    axis_values: axis,
    ...opts,
  };
}

const ch03: StepVariant[] = [
  v("ch03-c", "ch03", "CH03-C", null, { is_custom_order: true }),
  v("ch03-o-f", "ch03", "CH03-O-F", { wood: O, cushion: F }),
  v("ch03-o-p", "ch03", "CH03-O-P", { wood: O, cushion: P }),
  v("ch03-w-f", "ch03", "CH03-W-F", { wood: W, cushion: F }),
  v("ch03-w-p", "ch03", "CH03-W-P", { wood: W, cushion: P }),
  v("ch03-wg-f", "ch03", "CH03-Wenge-F", { wood: WG, cushion: F }),
  v("ch03-wg-l", "ch03", "CH03-Wenge-L", { wood: WG, cushion: L }),
];

const cb05: StepVariant[] = [
  v("cb05-c", "cb05", "CB05-C", null, { is_custom_order: true }),
  v("cb05-o-150h90", "cb05", "CB05-O-150H90", { wood: O, size: S150H90 }),
  v("cb05-o-180", "cb05", "CB05-O-180", { wood: O, size: S180 }),
  v("cb05-o-180h90", "cb05", "CB05-O-180H90", { wood: O, size: S180H90 }),
  v("cb05-so-180h90", "cb05", "CB05-SO-180H90", { wood: SO, size: S180H90 }),
  v("cb05-so-層留", "cb05", "CB05-SO-層留", null),
  v("cb05-t-150h90", "cb05", "CB05-T-150H90", { wood: T, size: S150H90 }),
  v("cb05-t-180h90", "cb05", "CB05-T-180H90", { wood: T, size: S180H90 }),
  v("cb05-w-180", "cb05", "CB05-W-180", { wood: W, size: S180 }),
];

describe("axisValuesOf", () => {
  const map = new Map([O, F].map((x) => [x.id, x]));
  it("依四個軸值 id 帶入名稱", () => {
    expect(axisValuesOf({ wood_value_id: O.id, cushion_value_id: F.id }, map)).toEqual({
      wood: O,
      cushion: F,
    });
  });
  it("全空或對不到主檔回傳 null（視為舊規格）", () => {
    expect(axisValuesOf({}, map)).toBeNull();
    expect(axisValuesOf({ wood_value_id: "unknown" }, map)).toBeNull();
  });
});

describe("splitSeriesVariants", () => {
  it("勾選生成的規格走步驟，舊規格與訂製款另列（訂製款排最後）", () => {
    const { axis, others } = splitSeriesVariants(cb05, "cb05", "");
    expect(axis.map((x) => x.id)).not.toContain("cb05-so-層留");
    expect(axis.map((x) => x.id)).not.toContain("cb05-c");
    expect(others.map((x) => x.id)).toEqual(["cb05-so-層留", "cb05-c"]);
  });

  it("已刪除規格只在已選中時保留", () => {
    const list = [...ch03, v("ch03-o-x", "ch03", "CH03-O-X", { wood: O, cushion: L }, { is_deleted: true })];
    expect(splitSeriesVariants(list, "ch03", "").axis.map((x) => x.id)).not.toContain("ch03-o-x");
    expect(splitSeriesVariants(list, "ch03", "ch03-o-x").axis.map((x) => x.id)).toContain("ch03-o-x");
  });

  it("未選系列不列任何規格", () => {
    expect(splitSeriesVariants(ch03, null, "")).toEqual({ axis: [], others: [] });
  });
});

describe("buildSteps", () => {
  const chairs = splitSeriesVariants(ch03, "ch03", "").axis;
  const cabinets = splitSeriesVariants(cb05, "cb05", "").axis;

  it("椅子：先木種，選完才出現座墊；沒用到的尺寸軸跳過", () => {
    const first = buildSteps(chairs, {});
    expect(first.steps.map((s) => s.axis)).toEqual(["wood"]);
    expect(first.steps[0].options.map((o) => o.label)).toEqual(["白橡木", "胡桃木", "雞翅木"]);
    expect(first.complete).toBe(false);
    expect(pendingStepTitle(first)).toBe("木種");

    const second = buildSteps(chairs, { wood: O.id });
    expect(second.steps.map((s) => s.axis)).toEqual(["wood", "cushion"]);
    expect(pendingStepTitle(second)).toBe("座墊");
  });

  it("後面的步驟只列出存在的組合（皮墊只有雞翅木）", () => {
    const oak = buildSteps(chairs, { wood: O.id });
    expect(oak.steps[1].options.map((o) => o.label)).toEqual(["布墊", "紙繩"]);
    const wenge = buildSteps(chairs, { wood: WG.id });
    expect(wenge.steps[1].options.map((o) => o.label)).toEqual(["布墊", "皮墊"]);
  });

  it("選完唯一一筆：complete 且 matches 只剩那筆；選項附帶可確定的規格", () => {
    const st = buildSteps(chairs, { wood: W.id, cushion: P.id });
    expect(st.complete).toBe(true);
    expect(st.matches.map((x) => x.id)).toEqual(["ch03-w-p"]);
    expect(pendingStepTitle(st)).toBeNull();
    expect(st.steps[1].options.find((o) => o.key === F.id)?.variant?.id).toBe("ch03-w-f");
    // 木種這步還對應多筆，不帶規格
    expect(st.steps[0].options.every((o) => o.variant == null)).toBe(true);
  });

  it("櫃子：木種 → 尺寸，尺寸附寬深高提示（名稱與代碼相同時不重複）", () => {
    const st = buildSteps(cabinets, { wood: O.id });
    expect(st.steps.map((s) => s.axis)).toEqual(["wood", "size"]);
    expect(st.steps[1].options.map((o) => [o.label, o.hint])).toEqual([
      ["150H90", "W150 D45 H90"],
      ["180", "W180 D42 H45"],
      ["180H90", "W180 D45 H90"],
    ]);
    const self = buildSteps([v("x", "s", "X", { wood: O, size: S60 })], { wood: O.id });
    expect(self.steps[1].options[0].hint).toBeNull();
  });

  it("前一步改選後，不成立的後續選擇視為未選", () => {
    const st = buildSteps(cabinets, { wood: SO.id, size: S150H90.id });
    expect(st.steps[1].chosen).toBeNull();
    expect(st.complete).toBe(false);
  });

  it("部分規格沒有某軸值 → 該步多一個「標準」且排第一；只有標準時跳過", () => {
    const cb03 = [
      v("cb03-o-150", "cb03", "CB03-O-150", { wood: O, size: S150H90 }),
      v("cb03-o-190", "cb03", "CB03-O-190", { wood: O, size: S190 }),
      v("cb03-o-190-md", "cb03", "CB03-O-190-MD", { wood: O, size: S190, config: MD }),
    ];
    const at190 = buildSteps(cb03, { wood: O.id, size: S190.id });
    expect(at190.steps.map((s) => s.axis)).toEqual(["wood", "size", "config"]);
    expect(at190.steps[2].options.map((o) => [o.key, o.label])).toEqual([
      [AXIS_NONE, "標準"],
      [MD.id, "抽屜置中"],
    ]);
    const at150 = buildSteps(cb03, { wood: O.id, size: S150H90.id });
    expect(at150.complete).toBe(true);
    expect(at150.steps.map((s) => s.axis)).toEqual(["wood", "size"]);
    expect(at150.matches.map((x) => x.id)).toEqual(["cb03-o-150"]);
  });

  it("組合重複時 complete 但 matches 多筆，提示再選規格", () => {
    const dup = [
      v("a", "s", "A", { wood: O }),
      v("b", "s", "B", { wood: O }),
    ];
    const st = buildSteps(dup, { wood: O.id });
    expect(st.complete).toBe(true);
    expect(st.matches).toHaveLength(2);
    expect(pendingStepTitle(st)).toBe("規格");
  });
});

describe("choicesOf", () => {
  it("已選規格回推各軸（沒有的軸＝標準）", () => {
    expect(choicesOf(ch03[1])).toEqual({
      wood: O.id,
      size: AXIS_NONE,
      cushion: F.id,
      config: AXIS_NONE,
    });
  });

  it("回推的選擇可直接重建出同一筆", () => {
    const axis = splitSeriesVariants(cb05, "cb05", "").axis;
    for (const target of axis) {
      const st = buildSteps(axis, choicesOf(target));
      expect(st.complete).toBe(true);
      expect(st.matches.map((x) => x.id)).toEqual([target.id]);
    }
  });
});

describe("pickAxisValue", () => {
  const chairs = splitSeriesVariants(ch03, "ch03", "").axis;
  const cabinets = splitSeriesVariants(cb05, "cb05", "").axis;

  it("選木種後座墊尚未選 → 未確定", () => {
    const r = pickAxisValue(chairs, {}, "wood", W.id);
    expect(r.variantId).toBeNull();
    expect(r.choices).toEqual({ wood: W.id });
  });

  it("選完座墊 → 確定規格", () => {
    const r = pickAxisValue(chairs, { wood: W.id }, "cushion", F.id);
    expect(r.variantId).toBe("ch03-w-f");
  });

  it("換木種時保留仍存在的座墊，直接換成對應規格", () => {
    const r = pickAxisValue(chairs, choicesOf(ch03[3]), "wood", WG.id);
    expect(r.variantId).toBe("ch03-wg-f");
  });

  it("換木種後座墊不存在 → 清掉座墊、等重選", () => {
    const r = pickAxisValue(chairs, { wood: WG.id, cushion: L.id }, "wood", O.id);
    expect(r.variantId).toBeNull();
    expect(r.choices).toEqual({ wood: O.id });
  });

  it("只剩一個選項的步驟自動帶入（煙燻白橡木只有 180H90）", () => {
    const r = pickAxisValue(cabinets, {}, "wood", SO.id);
    expect(r.variantId).toBe("cb05-so-180h90");
    expect(r.choices).toEqual({ wood: SO.id, size: S180H90.id });
  });

  it("換回原本的木種不會冒出先前被清掉的尺寸", () => {
    const toTeak = pickAxisValue(cabinets, { wood: O.id, size: S180.id }, "wood", T.id);
    expect(toTeak.choices).toEqual({ wood: T.id });
    const back = pickAxisValue(cabinets, toTeak.choices, "wood", O.id);
    expect(back.variantId).toBeNull();
    expect(back.choices).toEqual({ wood: O.id });
  });
});

describe("searchVariants", () => {
  const all = [...ch03, ...cb05].map((x) => ({ ...x, series_name: x.series_id === "ch03" ? "CH03 扶手椅" : "CB05 電視櫃" }));

  it("編號開頭符合者優先，忽略大小寫與連字號", () => {
    expect(searchVariants(all, "ch03wf").map((x) => x.id)).toEqual(["ch03-w-f"]);
    expect(searchVariants(all, "cb05-o").map((x) => x.id)).toEqual([
      "cb05-o-150h90",
      "cb05-o-180",
      "cb05-o-180h90",
    ]);
  });

  it("也可用系列名稱找，排除已刪除與空白查詢", () => {
    expect(searchVariants(all, "扶手椅").length).toBeGreaterThan(0);
    expect(searchVariants(all, "  ")).toEqual([]);
    const withDeleted = [...all, { ...all[1], id: "gone", product_code: "CH03-ZZ", is_deleted: true }];
    expect(searchVariants(withDeleted, "ch03-zz")).toEqual([]);
  });

  it("最多回傳 limit 筆", () => {
    expect(searchVariants(all, "c", 3)).toHaveLength(3);
  });
});
