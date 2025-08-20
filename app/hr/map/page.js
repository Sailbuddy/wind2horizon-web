'use client'
import dynamic from 'next/dynamic'

const GoogleMap = dynamic(() => import('@/components/GoogleMapClient'), { ssr: false })

export default function MapPage() {
  return (
    <div>
      <div className="toolbar">
        <span className="badge">Markers from Supabase (hr)</span>
      </div>
      <GoogleMap lang="hr" />
    </div>
  )
}