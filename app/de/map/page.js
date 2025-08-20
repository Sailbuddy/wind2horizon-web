'use client'
import dynamic from 'next/dynamic'

// GoogleMapClient dynamisch laden (nur im Browser, kein SSR)
const GoogleMap = dynamic(() => import('@/components/GoogleMapClient'), { ssr: false })

export default function MapPage() {
  return (
    <div>
      <div className="toolbar">
        <span className="badge">Markers from Supabase (de)</span>
      </div>
      <GoogleMap lang="de" />
    </div>
  )
}