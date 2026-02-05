// app/it/layout.tsx
import { buildLangMetadata } from "@/lib/seo";

export const metadata = buildLangMetadata("it");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}