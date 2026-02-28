import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: "" }));

  const expected = process.env.W2H_GATE_PASS || "";
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Server not configured" },
      { status: 500 }
    );
  }

  if (password !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });

  // 7 Tage gültig
  res.cookies.set("w2h_gate", "ok", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
}