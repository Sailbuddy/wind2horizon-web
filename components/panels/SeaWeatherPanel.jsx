'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';

export default function SeaWeatherPanel({ lang = 'de', label }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  const t = useMemo(
    () => ({
      fallbackTitle: label?.('seaWeatherTitle', lang) ?? 'Seewetterbericht (Adria)',
      hint: label?.('seaWeatherHint', lang) ?? 'Quelle: Meteo.hr (offiziell)',
      openOfficial: label?.('openOfficial', lang) ?? 'Offiziell öffnen',
      updated: label?.('updated', lang) ?? 'Stand',
      reload: label?.('reload', lang) ?? 'Aktualisieren',
      loading: label?.('loading', lang) ?? 'Lädt…',
      loadError: label?.('seaWeatherLoadError', lang) ?? 'Fehler beim Laden des Seewetterberichts',
    }),
    [lang, label]
  );

  const locale = useMemo(() => {
    // fr existiert bei euch im UI, Blob-API mapped fr -> en
    if (lang === 'de') return 'de-DE';
    if (lang === 'it') return 'it-IT';
    if (lang === 'hr') return 'hr-HR';
    return 'en-GB';
  }, [lang]);

  const fmtDate = useCallback(
    (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    },
    [locale]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);

    try {
      const res = await fetch(`/api/seewetter?lang=${encodeURIComponent(lang)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          json?.error ||
          (json?.ok === false ? 'Seewetter nicht verfügbar' : null) ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }

      if (json?.ok === false) {
        throw new Error(json?.error || 'Seewetter nicht verfügbar');
      }

      setData(json);
    } catch (e) {
      setErr(e?.message || t.loadError);
    } finally {
      setLoading(false);
    }
  }, [lang, t.loadError]);

  useEffect(() => {
    load();
    // 10 min Refresh ist ok (Peak 10 min / Offpeak stündlich -> wir lesen einfach öfter)
    const timer = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, [load]);

  const blocks = data?.blocks || {};
  const warning = blocks?.warning;
  const synopsis = blocks?.synopsis; // Wetterlage
  const forecast12 = blocks?.forecast_12h;
  const outlook12 = blocks?.outlook_12h;

  const sourceUrl =
    data?.sourceUrl ||
    'https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran&el=jadran_n';

  const standIso = data?.issuedAt || data?.fetchedAt || null;
  const standTxt = standIso ? fmtDate(standIso) : '';

  return (
    <div className="w2h-sea-wrap">
      <section className="w2h-card">
        <div className="w2h-head">
          <h1 className="w2h-h1">{data?.title || t.fallbackTitle}</h1>

          <div className="w2h-actions">
            <button className="w2h-btn" onClick={load} disabled={loading}>
              {loading ? '...' : t.reload}
            </button>

            <a className="w2h-btn w2h-btn-secondary" href={sourceUrl} target="_blank" rel="noreferrer">
              {t.openOfficial}
            </a>
          </div>
        </div>

        {t.hint && t.hint !== 'seaWeatherHint' ? (
          <p className="w2h-note">{t.hint}</p>
          ) : null}

        {err ? <div className="w2h-err">{err}</div> : null}

        {standTxt ? (
          <div className="w2h-meta">
            <span className="w2h-meta-k">{t.updated}:</span> {standTxt}
          </div>
        ) : null}
      </section>

      <section className="w2h-section">
        <div className="w2h-card">
          <div className="w2h-h2">{warning?.label || label?.('warning', lang) || 'Warnung'}</div>
          <div className="w2h-textblock">{warning?.text || '—'}</div>
        </div>

        <div className="w2h-card">
          <div className="w2h-h2">
            {synopsis?.label || label?.('weatherSituation', lang) || 'Wetterlage'}
          </div>
          <div className="w2h-textblock">{synopsis?.text || '—'}</div>
        </div>

        <div className="w2h-card">
          <div className="w2h-h2">
            {forecast12?.label || label?.('forecast12', lang) || 'Vorhersage (nächste 12h)'}
          </div>
          <div className="w2h-textblock">{forecast12?.text || '—'}</div>
        </div>

        <div className="w2h-card">
          <div className="w2h-h2">
            {outlook12?.label || label?.('forecast24', lang) || 'Vorhersage (weitere 12h)'}
          </div>
          <div className="w2h-textblock">{outlook12?.text || '—'}</div>
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
          line-height: 1.15;
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
