import type { CustomerRow } from "@/types/crm";

export function exportCustomersCsv(records: CustomerRow[]) {
  if (!records.length) return;

  const headers = [
    "姓名",
    "電話",
    "LINE ID",
    "IG 帳號",
    "客戶來源",
    "客戶種類",
    "送貨地址",
    "客情備註",
  ];

  const rows = records.map((r) => [
    r.name,
    r.phone ?? "",
    r.line_id ?? "",
    r.ig_account ?? "",
    r.source ?? "",
    r.customer_type ?? "",
    r.delivery_address ?? "",
    r.notes ?? "",
  ]);

  const escape = (value: unknown) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const csv = [
    headers.join(","),
    ...rows.map((row) => row.map(escape).join(",")),
  ].join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `客戶名單_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

