// app/en/layout.tsx
import { buildLangMetadata } from "@/lib/seo";

export const metadata = buildLangMetadata("en");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}