import { NextRequest, NextResponse } from "next/server";

const LOCALES = new Set(["de", "en", "it", "fr", "hr"]);

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Wind2Horizon"',
    },
  });
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ----------------------------
  // 0) Skip Next internals / assets
  // (API lasse ich bewusst NICHT aus, damit auch /api geschützt ist.
  //  Wenn du /api offen lassen willst, sag's, dann nehmen wir es wieder raus.)
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
  // 1) Basic Auth Schutz
  // ----------------------------
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;

  // "Fail open" um dich bei fehlender ENV nicht auszusperren.
  // Wenn du maximale Sicherheit willst: return unauthorized();
  if (!user || !pass) {
    // trotzdem Language-Header setzen + Redirect-Logik beibehalten
    const res = NextResponse.next();
    const first = pathname.split("/").filter(Boolean)[0];
    const lang = LOCALES.has(first) ? first : "en";
    res.headers.set("x-w2h-lang", lang);
    return res;
  }

  const auth = req.headers.get("authorization") || "";
  const [scheme, encoded] = auth.split(" ");

  if (scheme !== "Basic" || !encoded) return unauthorized();

  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return unauthorized();
  }

  const idx = decoded.indexOf(":");
  if (idx < 0) return unauthorized();

  const u = decoded.slice(0, idx);
  const p = decoded.slice(idx + 1);

  if (u !== user || p !== pass) return unauthorized();

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