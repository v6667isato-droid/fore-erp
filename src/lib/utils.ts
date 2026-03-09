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

export function relName(rel: NameRel): string {
  if (!rel) return "";
  return Array.isArray(rel) ? rel[0]?.name ?? "" : rel.name ?? "";
}
