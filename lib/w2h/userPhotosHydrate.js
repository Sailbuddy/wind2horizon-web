// lib/w2h/userPhotosHydrate.js
// Variante A: Fetcher, der User-Fotos lädt und als Array zurückgibt (für Lightbox-Merge).
// KEIN DOM-Rendering im InfoWindow (das machen wir bewusst nicht mehr).

export async function hydrateUserPhotos(locationId, langCode = 'de') {
  const L = {
    de: { err: 'Fehler beim Laden der User-Fotos.' },
    en: { err: 'Failed to load user photos.' },
    it: { err: 'Errore nel caricamento delle foto utente.' },
    fr: { err: 'Erreur lors du chargement des photos utilisateur.' },
    hr: { err: 'Greška pri učitavanju korisničkih fotki.' },
  };
  const t = L[langCode] || L.en;

  const id = Number(locationId);
  if (!Number.isFinite(id)) return [];

  try {
    const res = await fetch(`/api/user-photos?location_ids=${encodeURIComponent(String(id))}`, { cache: 'no-store' });
    if (!res.ok) return [];

    const json = await res.json().catch(() => null);
    if (!json) return [];

    // Unterstützt beide mögliche Response-Formate:
    // A) { items: { "123": [ ... ] } }
    // B) { rows: [ {location_id:123,...}, ... ] }
    const rows =
      (json?.items && json.items[String(id)]) ||
      (Array.isArray(json?.rows) ? json.rows.filter((p) => Number(p.location_id) === id) : []) ||
      [];

    // Normalize zu Lightbox-kompatiblem Format
    // Wir nutzen: { public_url|url|thumb, caption, author, source:'user' }
    const out = (rows || [])
      .map((p) => {
        const url = p?.url || p?.public_url || p?.image_url || '';
        if (!url) return null;

        const thumb = p?.thumb || p?.thumb_url || ''; // optional
        const caption = (p?.caption || '').trim();
        const author = (p?.author || p?.credit || '').trim();

        return {
          source: 'user',
          url,
          public_url: url,
          thumb: thumb || '',
          caption,
          author,
        };
      })
      .filter(Boolean);

    return out;
  } catch (e) {
    // bewusst: keine UI-Meldung, nur leeres Ergebnis zurückgeben
    console.warn('[w2h] hydrateUserPhotos failed:', t.err, e);
    return [];
  }
}
