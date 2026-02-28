import { NextRequest, NextResponse } from "next/server";

const LOCALES = new Set(["de", "en", "it", "fr", "hr"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ✅ HARD TEST: muss IMMER greifen (Proof ob Middleware in Production läuft)
  if (pathname === "/__mw_test") {
    return new NextResponse("MW OK", { status: 418 });
  }

  // ----------------------------
  // Gate Flag + Cookie (für Debug)
  // ----------------------------
  const gateOn = true; // Feature-Flag
  const gateCookie = req.cookies.get("w2h_gate")?.value;

  // Helper: Immer Debug-Header setzen
  const withDebug = (res: NextResponse) => {
    res.headers.set("x-w2h-mw", "1");
    res.headers.set("x-w2h-gateon", gateOn ? "1" : "0");
    res.headers.set("x-w2h-gatecookie", gateCookie ? "yes" : "no");
    res.headers.set("x-w2h-path", pathname);
    return res;
  };

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
    return withDebug(NextResponse.next());
  }

  // ----------------------------
  // Gate-Seiten & Gate-API erlauben
  // ----------------------------
  if (pathname === "/gate" || pathname.startsWith("/api/gate")) {
    return withDebug(NextResponse.next());
  }

  // ----------------------------
  // 1) Gate Cookie prüfen
  // ----------------------------
  if (gateOn && gateCookie !== "ok") {
    const url = req.nextUrl.clone();
    url.pathname = "/gate";
    url.searchParams.set("next", pathname + (req.nextUrl.search || ""));
    return withDebug(NextResponse.redirect(url, 307));
  }

  // ----------------------------
  // 2) Root "/" -> "/de"
  // ----------------------------
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/de";
    return withDebug(NextResponse.redirect(url, 308));
  }

  // ----------------------------
  // 3) Sprache aus erstem Segment + Header für app/layout.tsx
  // ----------------------------
  const first = pathname.split("/").filter(Boolean)[0];
  const lang = LOCALES.has(first) ? first : "en";

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-w2h-lang", lang);

  return withDebug(
    NextResponse.next({
      request: { headers: requestHeaders },
    })
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};