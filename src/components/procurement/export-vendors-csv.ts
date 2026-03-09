import type { VendorRow } from "@/types/procurement";

export function exportVendorsCsv(records: VendorRow[]) {
  const headers = ["廠商名稱", "類別", "聯絡人", "地址", "電話", "Email", "網站", "備註"];
  const rows = records.map((r) => [
    r.name,
    r.main_category,
    r.contact_person ?? "",
    r.address ?? "",
    r.phone ?? "",
    r.email ?? "",
    r.website ?? "",
    r.notes ?? "",
  ]);
  const csv = [headers.join(","), ...rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `廠商名單_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
