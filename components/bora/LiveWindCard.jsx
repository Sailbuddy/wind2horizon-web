'use client';

export default function LiveWindCard({ station = '16108', labelStation = 'Triest' }) {
  const url = `https://w2hlivewind.netlify.app?station=${encodeURIComponent(station)}`;

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
      <div className="text-lg font-bold text-slate-900 mb-2">
        Aktuell vor Ort – <span className="text-slate-700">{labelStation}</span>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-slate-600">
          Quelle: <a className="underline" href="https://meteostat.net" target="_blank" rel="noopener noreferrer">Meteostat</a>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:opacity-90"
        >
          Vollansicht öffnen
        </a>
      </div>

      <div className="mt-3 text-sm text-slate-600">
        Hinweis: Im nächsten Schritt können wir hier den Station-Picker wieder einbauen.
      </div>
    </section>
  );
}
