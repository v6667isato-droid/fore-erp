"use client";

import { useEffect, useMemo, useState } from "react";
import { groupVendorCategories, type VendorCategoryGroup } from "@/lib/vendor-category-groups";

export interface VendorCategoryPickerProps {
  id: string;
  /** 目前類別值（vendors.main_category，副類別文字） */
  value: string;
  onChange: (value: string) => void;
  /** 可選類別清單（副類別） */
  categories: string[];
  groups: VendorCategoryGroup[];
  /** dialog 開啟時重設自訂輸入狀態 */
  open: boolean;
  /** 自訂新類別要歸入的主類別 id（"" = 未分類）；提供時在自訂模式顯示歸入下拉 */
  customGroupId?: string;
  onCustomGroupChange?: (groupId: string) => void;
}

const CUSTOM_VALUE = "__custom";

/** 廠商類別選擇器：主類別（optgroup，深色粗體）＋副類別選項；可切換自訂輸入新類別 */
export function VendorCategoryPicker({ id, value, onChange, categories, groups, open, customGroupId, onCustomGroupChange }: VendorCategoryPickerProps) {
  const [custom, setCustom] = useState(false);

  const { grouped, ungrouped } = useMemo(() => groupVendorCategories(categories, groups), [categories, groups]);
  const isKnown = categories.includes(value);

  // 開關 dialog 時重設；值不在清單內時 showInput 會自動進入輸入模式
  useEffect(() => {
    setCustom(false);
  }, [open]);

  const showInput = custom || (value !== "" && !isKnown);
  const selectValue = showInput ? CUSTOM_VALUE : value;

  return (
    <div className="flex flex-col gap-1.5">
      <select
        id={id}
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM_VALUE) {
            setCustom(true);
            onChange("");
          } else {
            setCustom(false);
            onChange(v);
            // 離開自訂模式時清掉歸入設定，避免誤把既有類別改歸屬
            onCustomGroupChange?.("");
          }
        }}
        className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">（未設定）</option>
        <option value={CUSTOM_VALUE}>＋ 自訂新類別…</option>
        {grouped.map(({ group, categories: cats }) =>
          cats.length > 0 ? (
            <optgroup key={group.id} label={`▍${group.name}`} className="font-semibold text-foreground">
              {cats.map((c) => (
                <option key={c} value={c} className="font-normal text-foreground">{c}</option>
              ))}
            </optgroup>
          ) : null,
        )}
        {ungrouped.length > 0 && grouped.some((g) => g.categories.length > 0) ? (
          <optgroup label="未分類" className="font-semibold text-foreground">
            {ungrouped.map((c) => (
              <option key={c} value={c} className="font-normal text-foreground">{c}</option>
            ))}
          </optgroup>
        ) : (
          ungrouped.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))
        )}
      </select>
      {showInput && (
        <>
          <input
            id={`${id}-custom`}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="輸入新類別名稱，例：空壓機"
            aria-label="自訂類別名稱"
          />
          {onCustomGroupChange && groups.length > 0 && (
            <select
              id={`${id}-custom-group`}
              value={customGroupId ?? ""}
              onChange={(e) => onCustomGroupChange(e.target.value)}
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="歸入主類別"
              title="新類別存檔時會一併歸入所選主類別"
            >
              <option value="">歸入主類別：（未分類）</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>歸入主類別：{g.name}</option>
              ))}
            </select>
          )}
        </>
      )}
    </div>
  );
}
