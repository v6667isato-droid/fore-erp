import type {
  CostStatisticsFixedOverhead,
  CostStatisticsYearFixedOverhead,
  CostStatisticsYearSnapshot,
} from "@/lib/cost-statistics-settings";

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map(csvCell).join(",");
}

function downloadCsv(filename: string, sections: string[][]): void {
  const lines: string[] = [];
  for (const section of sections) {
    if (lines.length > 0) lines.push("");
    lines.push(...section);
  }
  const csv = lines.join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type ExportCurrentView = {
  year: number;
  ytdCutoffLabel: string;
  fixedOverhead: CostStatisticsFixedOverhead;
  totalPurchaseNonWood: number;
  totalPurchaseWood: number;
  totalPurchaseAmortized: number;
  totalSalaryCost: number;
  totalRentCost: number;
  totalCompanyLoanCost: number;
  totalTaxCost: number;
  totalCost: number;
  totalRevenue: number;
  grossProfit: number;
  grossMargin: number;
  monthlyRows: Array<{
    key: string;
    purchaseNonWood: number;
    purchaseWood: number;
    purchaseAmortized: number;
    salaryCost: number;
    rentCost: number;
    loanCost: number;
    taxCost: number;
    totalCost: number;
    revenue: number;
    grossProfit: number;
    grossMargin: number;
  }>;
};

export function exportCostStatisticsCsv(args: {
  current: ExportCurrentView;
  fixedOverheadHistory: Array<{ year: number; settings: CostStatisticsYearFixedOverhead }>;
  snapshots: Array<{ year: number; snapshot: CostStatisticsYearSnapshot }>;
}): void {
  const { current, fixedOverheadHistory, snapshots } = args;
  const date = new Date().toISOString().slice(0, 10);

  const fixedRows = [
    csvRow(["年度固定開銷紀錄"]),
    csvRow(["年度", "租金(年)", "公司貸款利息(年)", "最後更新"]),
    ...fixedOverheadHistory.map(({ year, settings }) =>
      csvRow([
        year,
        Math.round(settings.annualRent),
        Math.round(settings.annualCompanyLoanInterest),
        settings.updatedAt.slice(0, 19).replace("T", " "),
      ]),
    ),
  ];

  const summaryRows = [
    csvRow([`${current.year} 成本統計摘要（截至 ${current.ytdCutoffLabel}）`]),
    csvRow(["項目", "金額"]),
    csvRow(["非木料成本", Math.round(current.totalPurchaseNonWood)]),
    csvRow(["木料成本", Math.round(current.totalPurchaseWood)]),
    csvRow(["攤提", Math.round(current.totalPurchaseAmortized)]),
    csvRow(["薪資成本", Math.round(current.totalSalaryCost)]),
    csvRow(["租金", Math.round(current.totalRentCost)]),
    csvRow(["公司貸款利息", Math.round(current.totalCompanyLoanCost)]),
    csvRow(["稅金(營收5%)", Math.round(current.totalTaxCost)]),
    csvRow(["總成本", Math.round(current.totalCost)]),
    csvRow(["訂單營收", Math.round(current.totalRevenue)]),
    csvRow(["毛利", Math.round(current.grossProfit)]),
    csvRow(["毛利率(%)", current.grossMargin.toFixed(1)]),
    csvRow(["年度租金設定", Math.round(current.fixedOverhead.annualRent)]),
    csvRow(["年度公司貸款利息設定", Math.round(current.fixedOverhead.annualCompanyLoanInterest)]),
  ];

  const monthlyRows = [
    csvRow([`${current.year} 每月明細`]),
    csvRow([
      "月份",
      "非木料成本",
      "木料成本",
      "攤提",
      "薪資成本",
      "租金",
      "公司貸款利息",
      "稅金(營收5%)",
      "總成本",
      "訂單營收",
      "毛利",
      "毛利率(%)",
    ]),
    ...current.monthlyRows.map((row) =>
      csvRow([
        row.key,
        Math.round(row.purchaseNonWood),
        Math.round(row.purchaseWood),
        Math.round(row.purchaseAmortized),
        Math.round(row.salaryCost),
        Math.round(row.rentCost),
        Math.round(row.loanCost),
        Math.round(row.taxCost),
        Math.round(row.totalCost),
        Math.round(row.revenue),
        Math.round(row.grossProfit),
        row.grossMargin.toFixed(1),
      ]),
    ),
  ];

  const snapshotSections: string[][] = [];
  for (const { year, snapshot } of snapshots) {
    snapshotSections.push([
      csvRow([`${year} 已儲存紀錄（${snapshot.savedAt.slice(0, 19).replace("T", " ")}）`]),
      csvRow(["統計截止", snapshot.ytdCutoffLabel]),
      csvRow(["非木料成本", Math.round(snapshot.totalPurchaseNonWood)]),
      csvRow(["木料成本", Math.round(snapshot.totalPurchaseWood)]),
      csvRow(["攤提", Math.round(snapshot.totalPurchaseAmortized ?? 0)]),
      csvRow(["薪資成本", Math.round(snapshot.totalSalaryCost)]),
      csvRow(["租金", Math.round(snapshot.totalRentCost)]),
      csvRow(["公司貸款利息", Math.round(snapshot.totalCompanyLoanCost)]),
      csvRow([
        "稅金(營收5%)",
        Math.round(snapshot.totalTaxCost ?? snapshot.totalRevenue * 0.05),
      ]),
      csvRow(["總成本", Math.round(snapshot.totalCost)]),
      csvRow(["訂單營收", Math.round(snapshot.totalRevenue)]),
      csvRow(["毛利", Math.round(snapshot.grossProfit)]),
      csvRow(["毛利率(%)", snapshot.grossMargin.toFixed(1)]),
    ]);
  }

  downloadCsv(`成本統計_${current.year}_${date}.csv`, [
    fixedRows,
    summaryRows,
    monthlyRows,
    ...snapshotSections,
  ]);
}
