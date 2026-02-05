import { NextRequest, NextResponse } from "next/server";

const LOCALES = new Set(["de", "en", "it", "fr", "hr"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip Next internals / assets / API
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap") ||
    pathname.startsWith("/og/") ||
    pathname.match(/\.(?:png|jpg|jpeg|webp|svg|ico|css|js|map|txt)$/)
  ) {
    return NextResponse.next();
  }

  // Optional: Root "/" -> "/de" (wenn du das so willst)
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/de";
    return NextResponse.redirect(url, 308);
  }

  // Sprache aus erstem Segment
  const first = pathname.split("/").filter(Boolean)[0];
  const lang = LOCALES.has(first) ? first : "en";

  // Header setzen, damit app/layout.tsx daraus <html lang> baut
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-w2h-lang", lang);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
