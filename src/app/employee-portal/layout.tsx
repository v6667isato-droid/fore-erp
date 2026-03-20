import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "員工儀表板 | Fore Furniture",
  description: "Føre Furniture 實木工坊 — 員工個人入口",
};

export default function EmployeePortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
