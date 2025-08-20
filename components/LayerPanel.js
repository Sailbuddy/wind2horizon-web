'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function LayerPanel({ lang='de', onToggle }) {
  const [cats, setCats] = useState([]);
  const [state, setState] = useState(new Map());

  // Kategorien aus Supabase holen
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id,name_de,name_en,name_hr,icon_svg,is_default_on,sort_index')
        .order('sort_index', { ascending: true });

      if (error) { console.error(error); return; }

      const m = new Map();
      (data || []).forEach(c => m.set(c.id, !!c.is_default_on));
      setState(m);
      setCats(data || []);
    })();
  }, []);

  // Übersetzung pro Sprache wählen
  const t = (c) =>
    (lang==='de' && c.name_de) ||
    (lang==='hr' && c.name_hr) ||
    c.name_en ||
    c.name_de ||
    '–';

  return (
    <div className="w2h-layer-panel">
      {cats.map(c => (
        <label key={c.id} className="row">
          <input
            type="checkbox"
            checked={!!state.get(c.id)}
            onChange={e => {
              const v = e.target.checked;
              const next = new Map(state);
              next.set(c.id, v);
              setState(next);
              onToggle?.(c.id, v);
            }}
          />
          <span className="icon" dangerouslySetInnerHTML={{ __html: c.icon_svg || '' }} />
          <span className="name">{t(c)}</span>
        </label>
      ))}

      <style jsx global>{`
        .w2h-layer-panel {
          position: absolute;
          top: 12px;
          left: 12px;
          z-index: 5;
          background: rgba(255,255,255,.92);
          border-radius: 8px;
          padding: 8px 10px;
          box-shadow: 0 4px 16px rgba(0,0,0,.15);
          font: 14px/1.25 system-ui, sans-serif;
        }
        .w2h-layer-panel .row {
          display:flex;
          align-items:center;
          gap:8px;
          margin:6px 0;
        }
        .w2h-layer-panel .icon svg {
          width:18px;
          height:18px;
          vertical-align:middle;
        }
      `}</style>
    </div>
  );
}
