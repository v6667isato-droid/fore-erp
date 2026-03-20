import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "員工儀表板 | Føre Furniture",
  description: "Føre Furniture — 員工個人儀表板",
};

export default function EmployeeDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
