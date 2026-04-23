'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

const LeafletMapInner = dynamic(() => import('./leaflet-map-inner'), {
  ssr: false,
  loading: () => (
    <div
      className="w-full flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200"
      style={{ minHeight: 240 }}
    >
      <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
    </div>
  ),
})

export default LeafletMapInner
export type { MapMarker, MapPolyline } from './leaflet-map-inner'
