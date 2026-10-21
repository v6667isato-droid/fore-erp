"use client";

import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildSteps,
  choicesOf,
  pendingStepTitle,
  pickAxisValue,
  searchVariants,
  splitSeriesVariants,
  type AxisChoices,
  type StepVariant,
  type VariantAxis,
} from "@/lib/variant-steps";

const chipBase =
  "inline-flex min-h-9 flex-col items-start justify-center rounded-md border px-3 py-1 text-left text-sm leading-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const chipOn = "border-primary bg-primary/10 font-medium text-primary";
const chipOff = "border-input bg-background text-foreground hover:bg-accent";

function formatPrice(price: number | null | undefined): string | null {
  return price != null && Number.isFinite(Number(price)) && Number(price) > 0
    ? `$${Number(price).toLocaleString()}`
    : null;
}

function Chip({
  selected,
  label,
  sub,
  title,
  disabled,
  onClick,
}: {
  selected: boolean;
  label: string;
  sub?: string | null;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(chipBase, selected ? chipOn : chipOff)}
    >
      <span className="[overflow-wrap:anywhere]">{label}</span>
      {sub ? (
        <span
          className={cn(
            "text-[11px] font-normal tabular-nums",
            selected ? "text-primary/80" : "text-muted-foreground"
          )}
        >
          {sub}
        </span>
      ) : null}
    </button>
  );
}

function StepRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{title}</span>
      <div role="group" aria-label={title} className="flex flex-wrap gap-2">
        {children}
      </div>
    </div>
  );
}

/**
 * 規格逐步挑選（訂單與通路下單共用）：選系列後依序點選木種 → 尺寸／座墊 → 配置，
 * 選完才回傳 variant_id；中途改選前一步會保留仍成立的後續選擇。
 * 非勾選生成的舊規格與訂製款列在「其他」，點一下直接選定。
 */
export function VariantStepPicker<T extends StepVariant>({
  seriesId,
  variants,
  value,
  onChange,
  disabled = false,
}: {
  seriesId: string | null | undefined;
  variants: T[];
  /** 目前選定的 variant_id（未選＝空字串） */
  value: string;
  /** 選定唯一規格時回傳其 id；改選造成尚未選完時回傳空字串 */
  onChange: (variantId: string) => void;
  disabled?: boolean;
}) {
  /** 尚未選完的步驟選擇；系列或外部選定的規格改變時自動失效 */
  const [draft, setDraft] = useState<{
    seriesId: string;
    value: string;
    choices: AxisChoices;
  } | null>(null);

  const { axis: axisVariants, others } = useMemo(
    () => splitSeriesVariants(variants, seriesId, value),
    [variants, seriesId, value]
  );
  const selected = value ? variants.find((v) => v.id === value) : undefined;
  const selectedIsAxis = selected != null && axisVariants.some((v) => v.id === selected.id);

  const choices: AxisChoices =
    draft && draft.seriesId === seriesId && draft.value === value
      ? draft.choices
      : selectedIsAxis
        ? choicesOf(selected)
        : {};
  const state = buildSteps(axisVariants, choices);
  // 已選「其他」規格時步驟不標示選取
  const stepsActive = selectedIsAxis || !selected;

  function pick(axis: VariantAxis, key: string) {
    if (!seriesId) return;
    const r = pickAxisValue(axisVariants, stepsActive ? choices : {}, axis, key);
    if (r.variantId) {
      setDraft(null);
      if (r.variantId !== value) onChange(r.variantId);
      return;
    }
    setDraft({ seriesId, value: "", choices: r.choices });
    if (value) onChange("");
  }

  function pickDirect(variantId: string) {
    setDraft(null);
    if (variantId !== value) onChange(variantId);
  }

  if (!seriesId) {
    return (
      <p className="text-xs text-muted-foreground">先選系列，再依序選木種、規格；熟悉編號也可直接搜尋。</p>
    );
  }
  if (axisVariants.length === 0 && others.length === 0) {
    return <p className="text-xs text-muted-foreground">此系列目前沒有可選的規格。</p>;
  }

  const pending = stepsActive ? pendingStepTitle(state) : null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {axisVariants.length > 0
        ? state.steps.map((step) => (
            <StepRow key={step.axis} title={step.title}>
              {step.options.map((opt) => (
                <Chip
                  key={opt.key}
                  selected={stepsActive && step.chosen === opt.key}
                  label={opt.label}
                  sub={[opt.hint, formatPrice(opt.variant?.base_price)].filter(Boolean).join(" · ") || null}
                  title={opt.variant ? opt.variant.label : undefined}
                  disabled={disabled}
                  onClick={() => pick(step.axis, opt.key)}
                />
              ))}
            </StepRow>
          ))
        : null}
      {stepsActive && state.complete && state.matches.length > 1 ? (
        <StepRow title="規格">
          {state.matches.map((v) => (
            <Chip
              key={v.id}
              selected={v.id === value}
              label={v.product_code || v.label}
              sub={formatPrice(v.base_price)}
              title={v.label}
              disabled={disabled}
              onClick={() => pickDirect(v.id)}
            />
          ))}
        </StepRow>
      ) : null}
      {others.length > 0 ? (
        <StepRow title={axisVariants.length > 0 ? "其他" : "規格"}>
          {others.map((v) => (
            <Chip
              key={v.id}
              selected={v.id === value}
              label={v.is_custom_order ? "訂製款" : v.product_code || v.label}
              sub={formatPrice(v.base_price)}
              title={v.label}
              disabled={disabled}
              onClick={() => pickDirect(v.id)}
            />
          ))}
        </StepRow>
      ) : null}
      {selected ? (
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          已選：<span className="font-medium text-foreground">{selected.label}</span>
        </p>
      ) : (
        <p className="text-xs font-medium text-accent-warn">請選擇{pending ?? "規格"}</p>
      )}
    </div>
  );
}

/** 編號快速搜尋：輸入 CH03-W-F、cb05o 等即可直接選定規格（跨系列） */
export function VariantCodeSearch<T extends StepVariant & { series_name?: string | null }>({
  id,
  variants,
  onPick,
  disabled = false,
  placeholder = "輸入編號搜尋，如 CH03-W-F",
}: {
  id?: string;
  variants: T[];
  onPick: (variantId: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchVariants(variants, query), [variants, query]);
  const showList = open && query.trim() !== "";

  function pick(v: T) {
    onPick(v.id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative w-full min-w-0">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        enterKeyHint="search"
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            return;
          }
          if (!query.trim()) return;
          if (e.key === "Enter") {
            // 有輸入時 Enter 只選規格，不送出表單
            e.preventDefault();
            const hit = results[active] ?? results[0];
            if (hit) pick(hit);
          } else if (e.key === "ArrowDown" && results.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp" && results.length > 0) {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          }
        }}
        className="h-9 w-full min-w-0 rounded-lg border border-input bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-md"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">找不到符合的編號</li>
          ) : (
            results.map((v, i) => {
              const price = formatPrice(v.base_price);
              return (
                <li
                  key={v.id}
                  role="option"
                  aria-selected={i === active}
                  // 保持輸入框焦點，避免 blur 先關掉清單導致點不到
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(v)}
                  className={cn(
                    "cursor-pointer rounded-md px-3 py-2",
                    i === active ? "bg-accent" : "hover:bg-accent"
                  )}
                >
                  <span className="block font-mono text-xs font-semibold text-foreground">
                    {v.product_code || v.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[v.series_name, v.label, price].filter(Boolean).join(" · ")}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
