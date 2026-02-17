'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchBoraDeltaSeries, buildBoraCharts } from '@/lib/bora/boraForecast';
import BoraChart from '@/components/bora/BoraChart';
import BoraLegend from '@/components/bora/BoraLegend';
import LiveWindCard from '@/components/bora/LiveWindCard';

function levelBadge(level, minDelta, lang, label) {
  const base = 'w2h-badge';
  const tStorm = label ? label('boraLevelStorm', lang) : 'Stark';
  const tBora = label ? label('boraLevelBora', lang) : 'Bora';
  const tWatch = label ? label('boraLevelWatch', lang) : 'Achtung';
  const tNone = label ? label('boraLevelNone', lang) : 'Keine Bora';

  if (level === 'storm')
    return (
      <span className={`${base} w2h-badge-storm`}>
        {tStorm} (≤ −8) • min {minDelta} hPa
      </span>
    );

  if (level === 'bora')
    return (
      <span className={`${base} w2h-badge-bora`}>
        {tBora} (≤ −4) • min {minDelta} hPa
      </span>
    );

  if (level === 'watch')
    return (
      <span className={`${base} w2h-badge-watch`}>
        {tWatch} (&lt; 0) • min {minDelta} hPa
      </span>
    );

  return (
    <span className={`${base} w2h-badge-none`}>
      {tNone} • min {minDelta} hPa
    </span>
  );
}

export default function BoraPanel({ lang, label }) {
  const [charts, setCharts] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const series = await fetchBoraDeltaSeries();
      const built = buildBoraCharts(series);
      setCharts(built);
      setErr(null);
    } catch (e) {
      setErr(e?.message || 'Fehler beim Abrufen der Bora-Daten');
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = useMemo(
    () => ({
      title: label('boraTitle', lang),
      p1: label('boraP1', lang),
      p2: label('boraP2', lang),
      p3: label('boraP3', lang),
      note: label('boraNote', lang),
      week: label('boraWeek', lang) || 'Wochenprognose',
      h48: label('bora48h', lang) || 'Detailansicht der nächsten 48 Stunden',
      liveTitle: label('boraLiveTitle', lang) || 'Aktuell vor Ort – Triest',
    }),
    [lang, label]
  );

  return (
    <div className="w2h-bora-wrap">
      {/* Header / Erklärung */}
      <section className="w2h-card">
        <div className="w2h-head">
          <h1 className="w2h-h1">{t.title}</h1>
          {charts?.next36h ? levelBadge(charts.next36h.level, charts.next36h.minDelta, lang, label) : null}
        </div>

        <p className="w2h-p">{t.p1}</p>
        <p className="w2h-p">{t.p2}</p>
        <p className="w2h-p">{t.p3}</p>
        <p className="w2h-note">{t.note}</p>

        {err ? <div className="w2h-err">{err}</div> : null}
      </section>

      {/* Woche */}
      <section className="w2h-section">
        <BoraChart title={t.week} labels={charts?.week?.labels || []} data={charts?.week?.data || []} />
        <div className="w2h-legend-card">
          <BoraLegend />
        </div>
      </section>

      {/* LiveWind */}
      <section className="w2h-section">
        <div className="w2h-card">
          <div className="w2h-h2">{t.liveTitle}</div>
          <div className="w2h-live">
            <LiveWindCard station="16108" labelStation="Triest" />
          </div>
        </div>
      </section>

      {/* 48h */}
      <section className="w2h-section">
        <BoraChart title={t.h48} labels={charts?.h48?.labels || []} data={charts?.h48?.data || []} />
        <div className="w2h-legend-card">
          <BoraLegend />
        </div>
      </section>

      <style jsx>{`
        /* Wrapper: KEIN Vollflächen-Blau mehr */
        .w2h-bora-wrap {
          display: flex;
          flex-direction: column;
          gap: 14px;
          color: #0f172a;
        }

        /* Premium Card-Look wie dein altes, durchsichtiges Overlay */
        .w2h-card {
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 18px;
          padding: 14px 14px;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.14);
        }

        .w2h-legend-card {
          margin-top: 10px;
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid rgba(0, 0, 0, 0.06);
          border-radius: 16px;
          padding: 10px 12px;
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.12);
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

        .w2h-p {
          margin: 8px 0 0 0;
          font-size: 13px;
          line-height: 1.45;
          opacity: 0.92;
        }

        .w2h-note {
          margin: 10px 0 0 0;
          font-size: 12px;
          opacity: 0.72;
        }

        .w2h-err {
          margin-top: 10px;
          font-size: 12px;
          font-weight: 800;
          color: #b91c1c;
        }

        .w2h-live :global(.bg-white) {
          /* Falls LiveWindCard irgendwo "weiß" hardcoded ist, bleibt es trotzdem sauber */
          background: rgba(255, 255, 255, 0.96) !important;
        }

        /* Badges */
        .w2h-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 9999px;
          font-size: 12px;
          font-weight: 900;
          border: 1px solid rgba(0, 0, 0, 0.08);
          white-space: nowrap;
        }
        .w2h-badge-storm {
          background: rgba(239, 68, 68, 0.12);
          color: #991b1b;
        }
        .w2h-badge-bora {
          background: rgba(239, 68, 68, 0.07);
          color: #b91c1c;
        }
        .w2h-badge-watch {
          background: rgba(245, 158, 11, 0.10);
          color: #92400e;
        }
        .w2h-badge-none {
          background: rgba(15, 23, 42, 0.06);
          color: #334155;
        }

        @media (max-width: 640px) {
          .w2h-card {
            border-radius: 16px;
            padding: 12px;
          }
          .w2h-h1 {
            font-size: 17px;
          }
        }
      `}</style>
    </div>
  );
}
