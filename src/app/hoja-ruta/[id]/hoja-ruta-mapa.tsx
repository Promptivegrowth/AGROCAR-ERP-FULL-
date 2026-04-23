'use client'

import LeafletMap, { type MapMarker, type MapPolyline } from '@/components/maps/leaflet-map'

type Props = {
  almacen: { lat: number; lng: number; nombre: string }
  paradas: Array<{ secuencia: number; cliente: string; lat: number | null; lng: number | null; direccion: string | null }>
}

export default function HojaRutaMapa({ almacen, paradas }: Props) {
  const markers: MapMarker[] = [
    {
      id: 'almacen',
      lat: almacen.lat,
      lng: almacen.lng,
      label: almacen.nombre,
      initials: '🏬',
      color: '#0A0A0A',
    },
  ]

  const coords: [number, number][] = [[almacen.lat, almacen.lng]]
  paradas.forEach((p) => {
    if (p.lat == null || p.lng == null) return
    markers.push({
      id: `p-${p.secuencia}`,
      lat: Number(p.lat),
      lng: Number(p.lng),
      label: p.cliente,
      description: p.direccion ?? '',
      initials: String(p.secuencia),
      color: '#2563eb',
    })
    coords.push([Number(p.lat), Number(p.lng)])
  })
  coords.push([almacen.lat, almacen.lng])

  const polylines: MapPolyline[] = coords.length >= 2
    ? [{ id: 'ruta', positions: coords, color: '#2563eb' }]
    : []

  return <LeafletMap height="320px" markers={markers} polylines={polylines} fitBounds />
}
