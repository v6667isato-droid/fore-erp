import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { NameRel } from "@/types/procurement";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
  } catch {
    return value;
  }
}

/** 西元年後兩位：yy/mm/dd，適合表格欄寬較緊時 */
export function formatDateYyMmDd(value: string): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}/${mm}/${dd}`;
  } catch {
    return value;
  }
}

export function relName(rel: NameRel): string {
  if (!rel) return "";
  return Array.isArray(rel) ? rel[0]?.name ?? "" : rel.name ?? "";
}
