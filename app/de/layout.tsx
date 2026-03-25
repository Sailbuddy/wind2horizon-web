// app/de/layout.tsx
import { buildLangMetadata } from "@/lib/seo";

export const metadata = buildLangMetadata("de");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}