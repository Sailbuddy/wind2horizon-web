'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';         // relativ importieren
import LayerPanel from './LayerPanel';
import { defaultMarkerSvg } from './DefaultMarkerSvg';
import { svgToDataUrl } from '../lib/utils';

export default function GoogleMapClient({ lang = 'de' }) {
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const markers = useRef([]);           // google.maps.Marker[]
  const layerState = useRef(new Map()); // category_id -> visible
  const [ready, setReady] = useState(false);

  // 1) Google Maps Script laden
  useEffect(() => {
    if (window.google?.maps) { setReady(true); return; }
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=marker&language=${lang}&loading=async`;
    s.async = true;
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, [lang]);

  // 2) Map initialisieren
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    mapObj.current = new google.maps.Map(mapRef.current, {
      center: { lat: 45.6, lng: 13.8 },
      zoom: 7,
    });
    loadMarkers(lang);
  }, [ready, lang]);

  async function loadMarkers(langCode) {
    const { data, error } = await supabase
      .from('locations')
      .select(`
        id,lat,lng,category_id,display_name,name_de,name_en,name_hr,
        categories:category_id ( icon_svg )
      `);
    if (error) { console.error(error); return; }

    // alte Marker entfernen
    markers.current.forEach(m => m.setMap(null));
    markers.current = [];

    (data || []).forEach(row => {
      const title =
        (langCode === 'de' && row.name_de) ||
        (langCode === 'hr' && row.name_hr) ||
        row.name_en || row.display_name || '—';

      const svg = row.categories?.icon_svg || defaultMarkerSvg;

      const marker = new google.maps.Marker({
        position: { lat: row.lat, lng: row.lng },
        title,
        icon: {
          url: svgToDataUrl(svg),
          scaledSize: new google.maps.Size(28, 28),
          anchor: new google.maps.Point(14, 28)
        },
        map: mapObj.current
      });
      // eigene Property für Filter
      marker.category_id = row.category_id;

      marker.addListener('click', () => {
        const iw = new google.maps.InfoWindow({ content: `<div><strong>${title}</strong></div>` });
        iw.open({ map: mapObj.current, anchor: marker });
      });

      markers.current.push(marker);
    });

    applyLayerVisibility();
  }

  function applyLayerVisibility() {
    markers.current.forEach(m => {
      const vis = layerState.current.get(m.category_id);
      m.setVisible(vis ?? true);
    });
  }

  return (
    <>
      <div ref={mapRef} style={{ height: '100vh', width: '100%' }} />
      <LayerPanel
        lang={lang}
        onInit={(initialMap) => {
          // Initialzustand der Layer vom Panel übernehmen
          layerState.current = new Map(initialMap);
          applyLayerVisibility();
        }}
        onToggle={(catId, visible) => {
          layerState.current.set(catId, visible);
          applyLayerVisibility();
        }}
      />
    </>
  );
}
