'use client';

import { useEffect, useMemo, useState } from 'react';

export default function SeaWeatherPanel({ lang, label }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  const t = useMemo(
    () => ({
      title: label?.('seaWeatherTitle', lang) ?? 'Seewetterbericht (Adria)',
      hint: label?.('seaWeatherHint', lang) ?? 'Quelle: Meteo.hr (offiziell)',
      openOfficial: label?.('openOfficial', lang) ?? 'Offiziell öffnen',
      updated: label?.('updated', lang) ?? 'Stand',
      warning: label?.('warning', lang) ?? 'Warnung',
      situation: label?.('weatherSituation', lang) ?? 'Wetterlage',
      forecast12: label?.('forecast12', lang) ?? 'Vorhersage (nächste 12h)',
      forecast24: label?.('forecast24', lang) ?? 'Vorhersage (weitere 12h)',
      reload: label?.('reload', lang) ?? 'Aktualisieren',
    }),
    [lang, label]
  );

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/seewetter', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setErr(e?.message || 'Fehler beim Laden des Seewetterberichts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="w2h-sea-wrap">
      <section className="w2h-card">
        <div className="w2h-head">
          <h1 className="w2h-h1">{t.title}</h1>

          <div className="w2h-actions">
            <button className="w2h-btn" onClick={load} disabled={loading}>
              {loading ? '...' : t.reload}
            </button>

            <a
              className="w2h-btn w2h-btn-secondary"
              href="https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran&el=jadran_n"
              target="_blank"
              rel="noreferrer"
            >
              {t.openOfficial}
            </a>
          </div>
        </div>

        <p className="w2h-note">{t.hint}</p>

        {err ? <div className="w2h-err">{err}</div> : null}

        {data?.updatedAt ? (
          <div className="w2h-meta">
            <span className="w2h-meta-k">{t.updated}:</span> {data.updatedAt}
          </div>
        ) : null}
      </section>

      <section className="w2h-section">
        <div className="w2h-card">
          <div className="w2h-h2">{t.warning}</div>
          <div className="w2h-textblock">{data?.warning || '—'}</div>
        </div>

        <div className="w2h-card">
          <div className="w2h-h2">{t.situation}</div>
          <div className="w2h-textblock">{data?.situation || '—'}</div>
        </div>

        <div className="w2h-card">
          <div className="w2h-h2">{t.forecast12}</div>
          <div className="w2h-textblock">{data?.forecast12 || '—'}</div>
        </div>

        <div className="w2h-card">
          <div className="w2h-h2">{t.forecast24}</div>
          <div className="w2h-textblock">{data?.forecast24 || '—'}</div>
        </div>
      </section>

      <style jsx>{`
        .w2h-sea-wrap {
          display: flex;
          flex-direction: column;
          gap: 14px;
          color: #0f172a;
        }

        .w2h-card {
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 18px;
          padding: 14px 14px;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.14);
        }

        .w2h-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .w2h-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }

        .w2h-h1 {
          margin: 0;
          font-size: 18px;
          font-weight: 900;
          letter-spacing: 0.2px;
        }

        .w2h-h2 {
          font-size: 14px;
          font-weight: 900;
          margin-bottom: 10px;
        }

        .w2h-note {
          margin: 8px 0 0 0;
          font-size: 12px;
          opacity: 0.72;
        }

        .w2h-err {
          margin-top: 10px;
          font-size: 12px;
          font-weight: 800;
          color: #b91c1c;
        }

        .w2h-meta {
          margin-top: 10px;
          font-size: 12px;
          opacity: 0.85;
        }

        .w2h-meta-k {
          font-weight: 900;
          margin-right: 6px;
        }

        .w2h-actions {
          display: inline-flex;
          gap: 8px;
          align-items: center;
        }

        .w2h-btn {
          appearance: none;
          border: 0;
          cursor: pointer;
          background: #0284c7;
          color: white;
          font-weight: 900;
          font-size: 12px;
          padding: 9px 12px;
          border-radius: 999px;
          text-decoration: none;
          box-shadow: 0 10px 22px rgba(0, 0, 0, 0.18);
        }

        .w2h-btn:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .w2h-btn-secondary {
          background: #334155;
        }

        .w2h-textblock {
          white-space: pre-wrap;
          font-size: 13px;
          line-height: 1.45;
          opacity: 0.92;
        }
      `}</style>
    </div>
  );
}
