'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchBoraDeltaSeries, buildBoraCharts } from '@/lib/bora/boraForecast';
import BoraChart from '@/components/bora/BoraChart';
import BoraLegend from '@/components/bora/BoraLegend';
import LiveWindCard from '@/components/bora/LiveWindCard';

function levelBadge(level, minDelta) {
  const base = "inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold";
  if (level === 'storm') return <span className={`${base} bg-red-100 text-red-700`}>Stark (≤ −8) • min {minDelta} hPa</span>;
  if (level === 'bora')  return <span className={`${base} bg-red-50 text-red-700`}>Bora (≤ −4) • min {minDelta} hPa</span>;
  if (level === 'watch')
    return (
      <span className={`${base} bg-amber-50 text-amber-700`}>
        Achtung (&lt; 0) • min {minDelta} hPa
      </span>
    );
  return <span className={`${base} bg-slate-100 text-slate-700`}>Keine Bora • min {minDelta} hPa</span>;
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
  }, []);

  const t = useMemo(() => ({
    title: label('boraTitle', lang),
    p1: label('boraP1', lang),
    p2: label('boraP2', lang),
    p3: label('boraP3', lang),
    note: label('boraNote', lang),
    week: label('boraWeek', lang) || 'Wochenprognose',
    h48: label('bora48h', lang) || 'Detailansicht der nächsten 48 Stunden',
  }), [lang, label]);

  return (
    <div className="bg-sky-300/70 p-4 md:p-6">
      {/* Erklärungskarte */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-extrabold text-slate-900">{t.title}</h1>
          {charts?.next36h ? levelBadge(charts.next36h.level, charts.next36h.minDelta) : null}
        </div>

        <p className="mt-3 text-slate-800 leading-relaxed">{t.p1}</p>
        <p className="mt-2 text-slate-800 leading-relaxed">{t.p2}</p>
        <p className="mt-2 text-slate-800 leading-relaxed">{t.p3}</p>
        <p className="mt-3 text-sm text-slate-600">{t.note}</p>

        {err ? (
          <div className="mt-3 text-sm font-semibold text-red-600">
            {err}
          </div>
        ) : null}
      </section>

      {/* Woche */}
      <div className="mt-6">
        <BoraChart title={t.week} labels={charts?.week?.labels || []} data={charts?.week?.data || []} />
        <BoraLegend />
      </div>

      {/* LiveWind */}
      <div className="mt-6">
        <LiveWindCard station="16108" labelStation="Triest" />
      </div>

      {/* 48h */}
      <div className="mt-6">
        <BoraChart title={t.h48} labels={charts?.h48?.labels || []} data={charts?.h48?.data || []} />
        <BoraLegend />
      </div>

      <div className="h-6" />
    </div>
  );
}
