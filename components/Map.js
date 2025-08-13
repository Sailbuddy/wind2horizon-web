'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

export default function Map({ locale='de' }) {
  const mapRef = useRef(null)
  const containerRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let map
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: 'https://demotiles.maplibre.org/style.json',
        center: [13.6, 45.1],
        zoom: 6
      })
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    } catch (e) {
      setError(e.message)
    }
    mapRef.current = map
    return () => { if (map) map.remove() }
  }, [])

  useEffect(() => {
    async function loadMarkers() {
      try {
        const res = await fetch(`/data/locations_${locale}.json`)
        if (!res.ok) throw new Error(`Could not load locations_${locale}.json`)
        const data = await res.json()
        if (!mapRef.current) return

        data.forEach((item) => {
          const el = document.createElement('div')
          el.style.width = '12px'
          el.style.height = '12px'
          el.style.borderRadius = '50%'
          el.style.background = '#2563eb'
          el.style.border = '2px solid white'
          el.style.boxShadow = '0 0 0 1px rgba(0,0,0,.2)'
          const name = item[`name_${locale}`] || item.name || item.name_de || 'Location'
          const desc = item[`description_${locale}`] || item.description || ''
          const popupHtml = `<strong>${name}</strong>${desc ? `<br/><small>${desc}</small>` : ''}`
          new maplibregl.Marker({ element: el })
            .setLngLat([item.lng, item.lat])
            .setPopup(new maplibregl.Popup().setHTML(popupHtml))
            .addTo(mapRef.current)
        })
      } catch (e) {
        setError(e.message)
      }
    }
    loadMarkers()
  }, [locale])

  return (
    <div className="mapContainer" ref={containerRef}>
      {error && <div style={{position:'absolute', top:8, left:8}} className="code">Map error: {error}</div>}
    </div>
  )
}
