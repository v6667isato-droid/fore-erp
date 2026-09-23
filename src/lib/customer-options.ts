/** 客戶主檔下拉選項（新增／編輯客戶與貼上建立共用，改選項只需改這裡） */

/** 客戶來源（customers.source） */
export const CUSTOMER_SOURCE_OPTIONS = [
  "網路",
  "客戶引介",
  "設計師引介",
  "親友",
  "展覽(好感生活)",
  "展覽(木質生活)",
  "通路(謝木木工作室)",
] as const;

/** 客戶種類（customers.customer_type） */
export const CUSTOMER_TYPE_OPTIONS = [
  "一般民眾",
  "合作通路",
  "室內設計師",
  "建築師",
  "餐廳",
  "政府機關",
  "木工廠(代工)",
  "展覽",
] as const;

/** 主要聯絡方式（customers.contact_method）：value 存 DB、label 顯示 */
export const CONTACT_METHOD_OPTIONS = [
  { value: "line", label: "LINE" },
  { value: "ig", label: "IG" },
  { value: "fb", label: "FB" },
  { value: "email", label: "Email" },
  { value: "bingxueLine", label: "秉學Line" },
  { value: "others", label: "Others" },
] as const;
