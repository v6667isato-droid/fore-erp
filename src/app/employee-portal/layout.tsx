import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "員工儀表板 | Føre Furniture",
  description: "Føre Furniture — 員工個人入口",
};

export default function EmployeePortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
