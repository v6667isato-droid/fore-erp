import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "員工登入 | Føre Furniture",
  description: "Føre Furniture — 員工專屬入口",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
