# wind2horizon-web (Next.js Starter)

Starter für Wind2Horizon:
- Next.js (App Router) mit i18n (`de`, `en`, `it`, `hr`, `fr`)
- Karten-Seite mit MapLibre GL und Marker aus `/public/data/locations_{locale}.json`
- Supabase Auth (Client initialisiert, einfache Login/Logout-Seite vorbereitet)
- Platzhalter für Shop, Vouchers, Partner

## Schnellstart

```bash
npm install
npm run dev
```

### Env-Variablen (optional für Auth)
Erstelle `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Deploy auf Vercel
- Repo in Vercel importieren
- (optional) die obigen Env-Variablen in den Project Settings setzen
- Domain `beta.wind2horizon.com` zuweisen
