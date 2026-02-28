import { NextRequest, NextResponse } from "next/server";

function safeNextPath(raw: unknown) {
  const s = String(raw ?? "/de");
  // nur relative Pfade zulassen
  if (!s.startsWith("/")) return "/de";
  // "/" normalisieren
  if (s === "/") return "/de";
  return s;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const pass = String(body?.pass ?? "");
  const next = safeNextPath(body?.next);

  const expected = process.env.W2H_GATE_PASS ?? "";

  // Wenn kein Passwort gesetzt ist: lieber klarer Fehler (Debug spart Zeit)
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "W2H_GATE_PASS missing" },
      { status: 500 }
    );
  }

  const ok = pass.length > 0 && pass === expected;

  if (!ok) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });

  res.cookies.set("w2h_gate", "ok", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // ✅ lokal sonst kein Cookie
    sameSite: "lax",
    path: "/", // ✅ entscheidend
    maxAge: 60 * 60 * 24 * 7, // 7 Tage
  });

  // Debug
  res.headers.set("x-w2h-gate-set", "1");
  res.headers.set("x-w2h-next", next);

  return res;
}