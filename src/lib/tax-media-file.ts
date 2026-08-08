import { supabase } from "@/lib/supabase";
import type { AccountingInvoiceRow } from "@/lib/accounting-invoice";
import type { SalesInvoiceRow } from "@/lib/sales-invoice";

/**
 * 營業人進銷項資料檔（報稅媒體檔）產生器——進項＋銷項
 *
 * 每筆固定 81 字元、每張發票一行，欄位版面（起訖位置）：
 *   1-2   格式代號（21/22/25）
 *   3-11  申報營業人稅籍編號（9 碼）
 *   12-18 流水號（7 碼，左補 0，整檔連續編號不重複）
 *   19-21 資料所屬年度（民國年 3 碼）
 *   22-23 資料所屬月份（2 碼）
 *   24-31 買受人統一編號（進項＝本公司統編）
 *   32-39 銷售人統一編號（賣方統編）
 *   40-41 發票字軌（2 碼英文）
 *   42-49 發票號碼（8 碼數字）
 *   50-61 銷售金額（未稅，12 碼，左補 0，整數）
 *   62    課稅別（1 應稅／2 零稅率／3 免稅）
 *   63-72 營業稅額（10 碼，左補 0，整數）
 *   73    扣抵代號（1-4）
 *   74-78 保留欄位（空白）
 *   79    特種稅額稅率（空白＝非特種稅額）
 *   80    彙加註記（空白＝非彙加）
 *   81    通關方式註記（零稅率才填，其餘空白）
 *
 * 內容全為 ASCII，無編碼問題；行尾用 CRLF（申報軟體為 Windows 環境）。
 */

export interface CompanyTaxProfile {
  /** 公司統一編號（8 碼） */
  taxId: string;
  /** 稅籍編號（9 碼） */
  taxRegistrationNumber: string;
}

/** 西元 YYYY-MM-DD → 民國 { year: "115", month: "07" }；格式不符回傳 null */
function toRocYearMonth(isoDate: string): { year: string; month: string } | null {
  const m = isoDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return null;
  const rocYear = Number(m[1]) - 1911;
  if (rocYear <= 0) return null;
  return { year: String(rocYear).padStart(3, "0"), month: m[2] };
}

/** 申報期別（雙月）：發票日期所屬期別的起始月，如 2026-06-15 → "2026-05"（115年5-6月期） */
export function periodStartMonth(isoDate: string): string {
  const year = isoDate.slice(0, 4);
  const month = Number(isoDate.slice(5, 7));
  const start = month % 2 === 0 ? month - 1 : month;
  return `${year}-${String(start).padStart(2, "0")}`;
}

/** 期別顯示名稱："2026-05" → "民國115年 5-6月" */
export function periodLabel(startMonth: string): string {
  const year = Number(startMonth.slice(0, 4)) - 1911;
  const m = Number(startMonth.slice(5, 7));
  return `民國${year}年 ${m}-${m + 1}月`;
}

export interface MediaFileIssue {
  invoiceNumber: string;
  message: string;
}

export interface MediaFileResult {
  /** 媒體檔內容（CRLF 換行）；有任何 issue 時為 null */
  content: string | null;
  /** 建議檔名：{統編}.txt */
  fileName: string;
  /** 逐張驗證未通過的原因（全部通過才產檔） */
  issues: MediaFileIssue[];
  /** 各格式代號張數統計 */
  countByFormat: Record<string, number>;
}

function pad(value: string, length: number): string {
  return value.padEnd(length, " ").slice(0, length);
}

function padAmount(value: number, length: number): string {
  return String(Math.round(value)).padStart(length, "0");
}

/** 逐張驗證並組出 81 字元媒體檔內容 */
export function buildTaxMediaFile(
  invoices: AccountingInvoiceRow[],
  profile: CompanyTaxProfile,
): MediaFileResult {
  const issues: MediaFileIssue[] = [];
  const countByFormat: Record<string, number> = {};
  const lines: string[] = [];

  const taxId = profile.taxId.trim();
  const regNo = profile.taxRegistrationNumber.trim();
  if (!/^\d{8}$/.test(taxId)) issues.push({ invoiceNumber: "（公司設定）", message: "公司統一編號須為 8 碼數字" });
  if (!/^\d{9}$/.test(regNo)) issues.push({ invoiceNumber: "（公司設定）", message: "稅籍編號須為 9 碼數字" });

  // 依格式代號、發票日期排序後整檔連續編流水號
  const sorted = [...invoices].sort(
    (a, b) =>
      a.format_code.localeCompare(b.format_code) ||
      (a.invoice_date ?? "").localeCompare(b.invoice_date ?? "") ||
      (a.invoice_number ?? "").localeCompare(b.invoice_number ?? ""),
  );

  let serial = 0;
  for (const inv of sorted) {
    const label = inv.invoice_number ?? "（無號碼）";
    const problems: string[] = [];

    const numberMatch = (inv.invoice_number ?? "").match(/^([A-Z]{2})-(\d{8})$/);
    if (!numberMatch) problems.push("發票號碼格式不正確");
    const roc = inv.invoice_date ? toRocYearMonth(inv.invoice_date) : null;
    if (!roc) problems.push("缺少發票日期");
    if (!/^\d{8}$/.test(inv.seller_tax_id ?? "")) problems.push("賣方統編須為 8 碼數字");
    // 只申報公司發票：買方統編必須是本公司。無統編＝家庭發票（呼叫端已排除），不可蓋上公司統編申報
    if (!(inv.buyer_tax_id ?? "").trim()) problems.push("無買方統編（家庭發票）不可列入申報");
    else if (inv.buyer_tax_id!.trim() !== taxId)
      problems.push(`買方統編（${inv.buyer_tax_id}）與公司統編（${taxId}）不符`);
    if (inv.amount_ex_tax == null) problems.push("缺少未稅金額");
    if (inv.tax_amount == null) problems.push("缺少稅額");
    if ((inv.tax_type === 2 || inv.tax_type === 3) && inv.deduction_code !== 3 && inv.deduction_code !== 4)
      problems.push("零稅率／免稅的扣抵代號僅能為 3 或 4");
    if (inv.tax_type === 1 && inv.amount_ex_tax != null && inv.tax_amount != null) {
      const expected = Math.round(inv.amount_ex_tax * 0.05);
      if (Math.abs(Math.round(inv.tax_amount) - expected) > 1)
        problems.push(`稅額（${inv.tax_amount}）與未稅金額 5%（約 ${expected}）差距過大`);
    }

    if (problems.length > 0) {
      for (const message of problems) issues.push({ invoiceNumber: label, message });
      continue;
    }

    serial += 1;
    countByFormat[inv.format_code] = (countByFormat[inv.format_code] ?? 0) + 1;
    const line =
      inv.format_code + //                                1-2   格式代號
      regNo + //                                          3-11  稅籍編號
      String(serial).padStart(7, "0") + //                12-18 流水號
      roc!.year +
      roc!.month + //                                     19-23 資料所屬年月（民國）
      taxId + //                                          24-31 買受人統編（本公司）
      pad(inv.seller_tax_id ?? "", 8) + //                32-39 銷售人統編
      numberMatch![1] + //                                40-41 發票字軌
      numberMatch![2] + //                                42-49 發票號碼
      padAmount(inv.amount_ex_tax!, 12) + //              50-61 銷售金額（未稅）
      String(inv.tax_type) + //                           62    課稅別
      padAmount(inv.tax_amount!, 10) + //                 63-72 營業稅額
      String(inv.deduction_code) + //                     73    扣抵代號
      pad("", 5) + //                                     74-78 保留欄位
      pad("", 1) + //                                     79    特種稅額稅率
      pad("", 1) + //                                     80    彙加註記
      pad("", 1); //                                      81    通關方式註記
    lines.push(line);
  }

  return {
    content: issues.length === 0 && lines.length > 0 ? lines.join("\r\n") + "\r\n" : null,
    fileName: `${taxId || "media"}.txt`,
    issues,
    countByFormat,
  };
}

/**
 * 銷項格式代號推導：
 *   31 手開三聯式（B2B、尚未透過光賀開立電子發票）
 *   32 三聯式電子發票（B2B、光賀已回傳 external_id）
 *   35 二聯式／電子發票（B2C，無買受人統編）
 */
export function salesFormatCode(inv: SalesInvoiceRow): "31" | "32" | "35" {
  if (inv.invoice_type === "B2C") return "35";
  return inv.external_id ? "32" : "31";
}

/**
 * 逐張驗證並組出銷項媒體檔（81 字元版面同進項）：
 *   24-31 買受人統編（B2B 填客戶統編；B2C 空白）
 *   32-39 銷售人統編（本公司）
 *   73    扣抵代號（銷項不適用，空白）
 * 已作廢發票仍需列報（銷售金額與稅額以 0 申報）。
 * 折讓單（格式 33/34）欄位規格待與會計師／光賀確認，先不寫入檔案，於畫面另行提醒。
 */
export function buildSalesTaxMediaFile(
  invoices: SalesInvoiceRow[],
  profile: CompanyTaxProfile,
): MediaFileResult {
  const issues: MediaFileIssue[] = [];
  const countByFormat: Record<string, number> = {};
  const lines: string[] = [];

  const taxId = profile.taxId.trim();
  const regNo = profile.taxRegistrationNumber.trim();
  if (!/^\d{8}$/.test(taxId)) issues.push({ invoiceNumber: "（公司設定）", message: "公司統一編號須為 8 碼數字" });
  if (!/^\d{9}$/.test(regNo)) issues.push({ invoiceNumber: "（公司設定）", message: "稅籍編號須為 9 碼數字" });

  // 依格式代號、發票日期排序後整檔連續編流水號
  const sorted = [...invoices].sort(
    (a, b) =>
      salesFormatCode(a).localeCompare(salesFormatCode(b)) ||
      (a.invoice_date ?? "").localeCompare(b.invoice_date ?? "") ||
      (a.invoice_number ?? "").localeCompare(b.invoice_number ?? ""),
  );

  let serial = 0;
  for (const inv of sorted) {
    const label = inv.invoice_number ?? "（無號碼）";
    const voided = inv.status === "voided";
    const problems: string[] = [];

    const numberMatch = (inv.invoice_number ?? "").match(/^([A-Z]{2})-(\d{8})$/);
    if (!numberMatch) problems.push("發票號碼格式不正確");
    const roc = inv.invoice_date ? toRocYearMonth(inv.invoice_date) : null;
    if (!roc) problems.push("缺少發票日期");
    if (inv.invoice_type === "B2B" && !/^\d{8}$/.test(inv.buyer_tax_id ?? ""))
      problems.push("B2B 發票的買方統編須為 8 碼數字");
    if (!voided) {
      if (inv.amount_ex_tax == null) problems.push("缺少未稅金額");
      if (inv.tax_amount == null) problems.push("缺少稅額");
      if (inv.tax_type === 1 && inv.amount_ex_tax != null && inv.tax_amount != null) {
        const expected = Math.round(inv.amount_ex_tax * 0.05);
        if (Math.abs(Math.round(inv.tax_amount) - expected) > 1)
          problems.push(`稅額（${inv.tax_amount}）與未稅金額 5%（約 ${expected}）差距過大`);
      }
    }

    if (problems.length > 0) {
      for (const message of problems) issues.push({ invoiceNumber: label, message });
      continue;
    }

    const formatCode = salesFormatCode(inv);
    serial += 1;
    countByFormat[formatCode] = (countByFormat[formatCode] ?? 0) + 1;
    const line =
      formatCode + //                                     1-2   格式代號
      regNo + //                                          3-11  稅籍編號
      String(serial).padStart(7, "0") + //                12-18 流水號
      roc!.year +
      roc!.month + //                                     19-23 資料所屬年月（民國）
      pad(inv.invoice_type === "B2B" ? inv.buyer_tax_id ?? "" : "", 8) + // 24-31 買受人統編
      taxId + //                                          32-39 銷售人統編（本公司）
      numberMatch![1] + //                                40-41 發票字軌
      numberMatch![2] + //                                42-49 發票號碼
      padAmount(voided ? 0 : inv.amount_ex_tax!, 12) + // 50-61 銷售金額（未稅；作廢＝0）
      String(inv.tax_type) + //                           62    課稅別
      padAmount(voided ? 0 : inv.tax_amount!, 10) + //    63-72 營業稅額（作廢＝0）
      pad("", 1) + //                                     73    扣抵代號（銷項空白）
      pad("", 5) + //                                     74-78 保留欄位
      pad("", 1) + //                                     79    特種稅額稅率
      pad("", 1) + //                                     80    彙加註記
      pad("", 1); //                                      81    通關方式註記
    lines.push(line);
  }

  return {
    content: issues.length === 0 && lines.length > 0 ? lines.join("\r\n") + "\r\n" : null,
    fileName: `${taxId || "media"}-sales.txt`,
    issues,
    countByFormat,
  };
}

export interface CompanySettingsRow {
  company_name: string | null;
  tax_id: string | null;
  tax_registration_number: string | null;
}

/** 讀取公司稅籍設定（單筆；尚未設定時回傳 null） */
export async function fetchCompanySettings(): Promise<CompanySettingsRow | null> {
  const { data, error } = await supabase
    .from("company_settings")
    .select("company_name, tax_id, tax_registration_number")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    console.error("公司稅籍設定讀取失敗:", error.message);
    return null;
  }
  return data;
}

/** 儲存公司稅籍設定（upsert 單筆） */
export async function saveCompanySettings(taxId: string, taxRegistrationNumber: string): Promise<string | null> {
  const { error } = await supabase.from("company_settings").upsert({
    id: 1,
    tax_id: taxId.trim(),
    tax_registration_number: taxRegistrationNumber.trim(),
    updated_at: new Date().toISOString(),
  });
  return error ? error.message : null;
}
