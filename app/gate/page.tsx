"use client";

import { useMemo, useState } from "react";

export default function GatePage() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const next = useMemo(() => {
    if (typeof window === "undefined") return "/de";
    const sp = new URLSearchParams(window.location.search);
    const raw = sp.get("next") || "/de";

    // ✅ nur relative Pfade erlauben (kein open redirect)
    const safe = raw.startsWith("/") ? raw : "/de";

    // ✅ "/" würde sonst oft wieder auf Gate/Root führen -> normalize
    return safe === "/" ? "/de" : safe;
  }, []);

  async function submit() {
    if (!pw || loading) return;

    setErr(null);
    setLoading(true);

    try {
      const r = await fetch("/api/gate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pass: pw,  // ✅ passt zur API
          next,      // ✅ damit du später (optional) serverseitig debuggen kannst
        }),
      });

      if (r.status === 401) {
        setErr("Zugangsdaten falsch.");
        return;
      }

      if (!r.ok) {
        setErr("Serverfehler. Bitte später erneut versuchen.");
        return;
      }

      // ✅ harte Navigation: Middleware greift neu, Cookie wird mitgeschickt
      window.location.href = next;
    } catch {
      setErr("Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "linear-gradient(180deg, rgba(2,132,199,0.20), rgba(0,0,0,0.65))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        style={{
          width: "min(520px, 96vw)",
          borderRadius: 18,
          background: "rgba(255,255,255,0.95)",
          padding: 18,
          boxShadow: "0 25px 80px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>
          Wind2Horizon – Preview Zugang
        </div>
        <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 14 }}>
          Diese Version ist nur für ausgewählte Partner.
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Passwort"
            style={{
              flex: 1,
              padding: "12px 12px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.15)",
              outline: "none",
              fontSize: 14,
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoFocus
          />
          <button
            onClick={submit}
            disabled={loading || !pw}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "none",
              fontWeight: 900,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.7 : 1,
              background: "#0284c7",
              color: "white",
            }}
          >
            {loading ? "..." : "Öffnen"}
          </button>
        </div>

        {err && (
          <div style={{ marginTop: 10, color: "#b91c1c", fontSize: 13, fontWeight: 700 }}>
            {err}
          </div>
        )}
      </div>
    </div>
  );
}