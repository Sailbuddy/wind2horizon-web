// app/fr/layout.tsx
import { buildLangMetadata } from "@/lib/seo";

export const metadata = buildLangMetadata("fr");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}