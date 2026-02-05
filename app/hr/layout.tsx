// app/hr/layout.tsx
import { buildLangMetadata } from "@/lib/seo";

export const metadata = buildLangMetadata("hr");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}