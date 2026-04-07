'use client';

import { useState } from 'react';

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

function uiText(lang = 'de') {
  return {
    panelTitle:
      lang === 'de' ? 'Listen' :
      lang === 'en' ? 'Lists' :
      lang === 'it' ? 'Liste' :
      lang === 'fr' ? 'Listes' :
      lang === 'hr' ? 'Liste' :
      'Listen',

    panelSubtitle:
      lang === 'de' ? 'Aktive Liste und verfügbare Sammlungen' :
      lang === 'en' ? 'Active list and available collections' :
      lang === 'it' ? 'Lista attiva e raccolte disponibili' :
      lang === 'fr' ? 'Liste active et collections disponibles' :
      lang === 'hr' ? 'Aktivna lista i dostupne kolekcije' :
      'Aktive Liste und verfügbare Sammlungen',

    reload:
      lang === 'de' ? 'Neu laden' :
      lang === 'en' ? 'Reload' :
      lang === 'it' ? 'Ricarica' :
      lang === 'fr' ? 'Recharger' :
      lang === 'hr' ? 'Učitaj ponovno' :
      'Neu laden',

    loading:
      lang === 'de' ? 'Lädt...' :
      lang === 'en' ? 'Loading...' :
      lang === 'it' ? 'Caricamento...' :
      lang === 'fr' ? 'Chargement...' :
      lang === 'hr' ? 'Učitavanje...' :
      'Lädt...',

    activeList:
      lang === 'de' ? 'Aktive Liste' :
      lang === 'en' ? 'Active list' :
      lang === 'it' ? 'Lista attiva' :
      lang === 'fr' ? 'Liste active' :
      lang === 'hr' ? 'Aktivna lista' :
      'Aktive Liste',

    noActiveList:
      lang === 'de' ? 'Keine aktive Liste gefunden.' :
      lang === 'en' ? 'No active list found.' :
      lang === 'it' ? 'Nessuna lista attiva trovata.' :
      lang === 'fr' ? 'Aucune liste active trouvée.' :
      lang === 'hr' ? 'Nije pronađena aktivna lista.' :
      'Keine aktive Liste gefunden.',

    availableLists:
      lang === 'de' ? 'Verfügbare Listen' :
      lang === 'en' ? 'Available lists' :
      lang === 'it' ? 'Liste disponibili' :
      lang === 'fr' ? 'Listes disponibles' :
      lang === 'hr' ? 'Dostupne liste' :
      'Verfügbare Listen',

    noLists:
      lang === 'de' ? 'Keine Listen vorhanden.' :
      lang === 'en' ? 'No lists available.' :
      lang === 'it' ? 'Nessuna lista disponibile.' :
      lang === 'fr' ? 'Aucune liste disponible.' :
      lang === 'hr' ? 'Nema dostupnih lista.' :
      'Keine Listen vorhanden.',

    active:
      lang === 'de' ? 'Aktiv' :
      lang === 'en' ? 'Active' :
      lang === 'it' ? 'Attiva' :
      lang === 'fr' ? 'Active' :
      lang === 'hr' ? 'Aktivna' :
      'Aktiv',

    open:
      lang === 'de' ? 'Öffnen' :
      lang === 'en' ? 'Open' :
      lang === 'it' ? 'Apri' :
      lang === 'fr' ? 'Ouvrir' :
      lang === 'hr' ? 'Otvori' :
      'Öffnen',

    createTitle:
      lang === 'de' ? 'Neue Liste erstellen' :
      lang === 'en' ? 'Create new list' :
      lang === 'it' ? 'Crea nuova lista' :
      lang === 'fr' ? 'Créer une liste' :
      lang === 'hr' ? 'Izradi novu listu' :
      'Neue Liste erstellen',

    titlePlaceholder:
      lang === 'de' ? 'Titel der Liste' :
      lang === 'en' ? 'List title' :
      lang === 'it' ? 'Titolo della lista' :
      lang === 'fr' ? 'Titre de la liste' :
      lang === 'hr' ? 'Naziv liste' :
      'Titel der Liste',

    createButton:
      lang === 'de' ? 'Liste erstellen' :
      lang === 'en' ? 'Create list' :
      lang === 'it' ? 'Crea lista' :
      lang === 'fr' ? 'Créer la liste' :
      lang === 'hr' ? 'Izradi listu' :
      'Liste erstellen',

    creating:
      lang === 'de' ? 'Erstellt...' :
      lang === 'en' ? 'Creating...' :
      lang === 'it' ? 'Creazione...' :
      lang === 'fr' ? 'Création...' :
      lang === 'hr' ? 'Izrada...' :
      'Erstellt...',

    titleRequired:
      lang === 'de' ? 'Bitte einen Titel eingeben.' :
      lang === 'en' ? 'Please enter a title.' :
      lang === 'it' ? 'Inserisci un titolo.' :
      lang === 'fr' ? 'Veuillez saisir un titre.' :
      lang === 'hr' ? 'Unesite naziv.' :
      'Bitte einen Titel eingeben.',
  };
}

export default function CollectionsPanel({
  lang = 'de',
  collections = [],
  loading = false,
  error = '',
  activeCollectionId = null,
  activeCollection = null,
  createBusy = false,
  onReload,
  onSelectCollection,
  onCreateCollection,
}) {
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('favorites');
  const [createError, setCreateError] = useState('');

  const txt = uiText(lang);

  async function handleCreateSubmit(e) {
    e.preventDefault();

    try {
      setCreateError('');

      if (!String(newTitle || '').trim()) {
        setCreateError(txt.titleRequired);
        return;
      }

      if (typeof onCreateCollection === 'function') {
        await onCreateCollection({
          title: newTitle,
          collectionType: newType,
        });
      }

      setNewTitle('');
      setNewType('favorites');
    } catch (err) {
      setCreateError(String(err?.message || err));
    }
  }

  return (
    <div className="w2h-collections-wrap">
      <section className="w2h-card">
        <div className="w2h-head">
          <div>
            <h2 className="w2h-h1">{txt.panelTitle}</h2>
            <p className="w2h-sub">{txt.panelSubtitle}</p>
          </div>

          <button
            type="button"
            className="w2h-btn"
            onClick={() => onReload && onReload()}
            disabled={loading}
          >
            {loading ? txt.loading : txt.reload}
          </button>
        </div>

        {error ? <div className="w2h-err">{error}</div> : null}

        <div className="w2h-active-box">
          <div className="w2h-label">{txt.activeList}</div>

          {activeCollection ? (
            <div className="w2h-active-card">
              <div className="w2h-active-title">
                {activeCollection.title || activeCollection.name || `#${activeCollection.id}`}
              </div>
              <div className="w2h-type-badge">
                {getTypeLabel(activeCollection.type || activeCollection.collection_type, lang)}
              </div>
            </div>
          ) : (
            <div className="w2h-empty">{txt.noActiveList}</div>
          )}
        </div>
      </section>

      <section className="w2h-card">
        <div className="w2h-h2">{txt.createTitle}</div>

        <form className="w2h-create-form" onSubmit={handleCreateSubmit}>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={txt.titlePlaceholder}
            className="w2h-input"
            disabled={createBusy}
          />

          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="w2h-select"
            disabled={createBusy}
          >
            <option value="favorites">{getTypeLabel('favorites', lang)}</option>
            <option value="trip_plan">{getTypeLabel('trip_plan', lang)}</option>
            <option value="trip_report">{getTypeLabel('trip_report', lang)}</option>
          </select>

          <button
            type="submit"
            className="w2h-btn"
            disabled={createBusy}
          >
            {createBusy ? txt.creating : txt.createButton}
          </button>
        </form>

        {createError ? <div className="w2h-err">{createError}</div> : null}
      </section>

      <section className="w2h-card">
        <div className="w2h-h2">{txt.availableLists}</div>

        {!loading && (!collections || collections.length === 0) ? (
          <div className="w2h-empty">{txt.noLists}</div>
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
                    {getTypeLabel(item.type || item.collection_type, lang)}
                  </div>
                </div>

                <div className="w2h-row-side">
                  {isActive ? txt.active : txt.open}
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

        .w2h-create-form {
          display: grid;
          gap: 10px;
        }

        .w2h-input,
        .w2h-select {
          width: 100%;
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: #fff;
          border-radius: 12px;
          padding: 11px 12px;
          font-size: 14px;
          outline: none;
        }

        .w2h-input:focus,
        .w2h-select:focus {
          border-color: rgba(2, 132, 199, 0.45);
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