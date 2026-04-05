'use client';

function getTypeLabel(type, lang = 'de') {
  const t = String(type || '').toLowerCase();

  const dict = {
    favorites: {
      de: 'Favoriten',
      en: 'Favorites',
      it: 'Preferiti',
      fr: 'Favoris',
      hr: 'Favoriti',
    },
    trip_plan: {
      de: 'Planung',
      en: 'Trip plan',
      it: 'Pianificazione',
      fr: 'Planification',
      hr: 'Plan',
    },
    trip_report: {
      de: 'Törnbericht',
      en: 'Trip report',
      it: 'Report viaggio',
      fr: 'Compte-rendu',
      hr: 'Izvještaj',
    },
  };

  return dict[t]?.[lang] || dict[t]?.en || type || '—';
}

export default function CollectionsPanel({
  lang = 'de',
  collections = [],
  loading = false,
  error = '',
  activeCollectionId = null,
  activeCollection = null,
  onReload,
  onSelectCollection,
}) {
  return (
    <div className="w2h-collections-wrap">
      <section className="w2h-card">
        <div className="w2h-head">
          <div>
            <h2 className="w2h-h1">Listen</h2>
            <p className="w2h-sub">
              Aktive Liste und verfügbare Sammlungen
            </p>
          </div>

          <button
            type="button"
            className="w2h-btn"
            onClick={() => onReload && onReload()}
            disabled={loading}
          >
            {loading ? 'Lädt...' : 'Neu laden'}
          </button>
        </div>

        {error ? <div className="w2h-err">{error}</div> : null}

        <div className="w2h-active-box">
          <div className="w2h-label">Aktive Liste</div>

          {activeCollection ? (
            <div className="w2h-active-card">
              <div className="w2h-active-title">
                {activeCollection.title || activeCollection.name || `#${activeCollection.id}`}
              </div>
              <div className="w2h-type-badge">
                {getTypeLabel(activeCollection.type, lang)}
              </div>
            </div>
          ) : (
            <div className="w2h-empty">Keine aktive Liste gefunden.</div>
          )}
        </div>
      </section>

      <section className="w2h-card">
        <div className="w2h-h2">Verfügbare Listen</div>

        {!loading && (!collections || collections.length === 0) ? (
          <div className="w2h-empty">Keine Listen vorhanden.</div>
        ) : null}

        <div className="w2h-list">
          {collections.map((item) => {
            const isActive = Number(item.id) === Number(activeCollectionId);

            return (
              <button
                key={item.id}
                type="button"
                className={`w2h-row ${isActive ? 'is-active' : ''}`}
                onClick={() => onSelectCollection && onSelectCollection(item.id)}
                disabled={loading || isActive}
              >
                <div className="w2h-row-main">
                  <div className="w2h-row-title">
                    {item.title || item.name || `#${item.id}`}
                  </div>
                  <div className="w2h-row-meta">
                    {getTypeLabel(item.type, lang)}
                  </div>
                </div>

                <div className="w2h-row-side">
                  {isActive ? 'Aktiv' : 'Öffnen'}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <style jsx>{`
        .w2h-collections-wrap {
          display: flex;
          flex-direction: column;
          gap: 14px;
          color: #0f172a;
        }

        .w2h-card {
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 18px;
          padding: 14px;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.14);
        }

        .w2h-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }

        .w2h-h1 {
          margin: 0;
          font-size: 18px;
          font-weight: 900;
        }

        .w2h-h2 {
          margin: 0 0 10px 0;
          font-size: 14px;
          font-weight: 900;
        }

        .w2h-sub {
          margin: 6px 0 0 0;
          font-size: 12px;
          color: #64748b;
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
        }

        .w2h-btn:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .w2h-label {
          font-size: 12px;
          font-weight: 800;
          color: #475569;
          margin-bottom: 8px;
        }

        .w2h-active-box {
          margin-top: 12px;
        }

        .w2h-active-card {
          border: 1px solid rgba(2, 132, 199, 0.18);
          background: rgba(2, 132, 199, 0.06);
          border-radius: 14px;
          padding: 12px;
        }

        .w2h-active-title {
          font-size: 15px;
          font-weight: 900;
        }

        .w2h-type-badge {
          margin-top: 8px;
          display: inline-flex;
          align-items: center;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          background: rgba(15, 23, 42, 0.08);
          color: #334155;
        }

        .w2h-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .w2h-row {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          text-align: left;
          border: 1px solid rgba(0, 0, 0, 0.08);
          background: #fff;
          border-radius: 14px;
          padding: 12px;
          cursor: pointer;
        }

        .w2h-row.is-active {
          border-color: rgba(2, 132, 199, 0.35);
          background: rgba(2, 132, 199, 0.05);
        }

        .w2h-row:disabled {
          cursor: default;
          opacity: 0.85;
        }

        .w2h-row-main {
          min-width: 0;
        }

        .w2h-row-title {
          font-size: 14px;
          font-weight: 800;
        }

        .w2h-row-meta {
          margin-top: 4px;
          font-size: 12px;
          color: #64748b;
        }

        .w2h-row-side {
          flex: 0 0 auto;
          font-size: 12px;
          font-weight: 800;
          color: #0284c7;
        }

        .w2h-empty {
          font-size: 13px;
          color: #64748b;
          padding: 10px 0 2px 0;
        }

        .w2h-err {
          margin-top: 10px;
          font-size: 12px;
          font-weight: 800;
          color: #b91c1c;
        }
      `}</style>
    </div>
  );
}