'use client'
import dynamic from 'next/dynamic'
const Map = dynamic(() => import('../../../components/Map'), { ssr: false })

export default function MapPage() {
  return (
    <div>
      <div className="toolbar">
        <span className="badge">Markers from /data/locations_en.json</span>
      </div>
      <Map locale="en" />
    </div>
  )
}
