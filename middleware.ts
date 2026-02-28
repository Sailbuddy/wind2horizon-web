import { NextRequest, NextResponse } from "next/server";

const LOCALES = new Set(["de", "en", "it", "fr", "hr"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ----------------------------
  // Skip Next internals / assets
  // ----------------------------
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap") ||
    pathname.startsWith("/og/") ||
    pathname.match(/\.(?:png|jpg|jpeg|webp|svg|ico|css|js|map|txt)$/)
  ) {
    return NextResponse.next();
  }

  // ----------------------------
  // Gate-Seiten & Gate-API erlauben
  // ----------------------------
  if (pathname === "/gate" || pathname.startsWith("/api/gate")) {
    return NextResponse.next();
  }

  // ----------------------------
  // 1) Gate Cookie prüfen
  // ----------------------------
  const gateCookie = req.cookies.get("w2h_gate")?.value;
  const gateOn = process.env.W2H_GATE_ON === "1"; // Feature-Flag

  if (gateOn && gateCookie !== "ok") {
    const url = req.nextUrl.clone();
    url.pathname = "/gate";
    // optional: Rücksprung merken
    url.searchParams.set("next", pathname + (req.nextUrl.search || ""));
    return NextResponse.redirect(url, 307);
  }

  // ----------------------------
  // 2) Root "/" -> "/de"
  // ----------------------------
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/de";
    return NextResponse.redirect(url, 308);
  }

  // ----------------------------
  // 3) Sprache aus erstem Segment + Header für app/layout.tsx
  // ----------------------------
  const first = pathname.split("/").filter(Boolean)[0];
  const lang = LOCALES.has(first) ? first : "en";

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-w2h-lang", lang);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};