'use client'

import { Navigation } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import LeafletMap, { type MapMarker } from '@/components/maps/leaflet-map'

interface Checkin {
  id: string
  tipo: string
  latitud: number | null
  longitud: number | null
  created_at: string
  profiles?: { full_name?: string; role?: string } | null
  clientes?: { razon_social?: string } | null
}

interface Cliente {
  id: string
  razon_social: string
  latitud: number | null
  longitud: number | null
}

interface GpsMapPanelProps {
  checkins: Checkin[]
  clientes: Cliente[]
}

const COLOR_POR_TIPO: Record<string, string> = {
  inicio_jornada: '#10b981',
  en_ruta: '#3b82f6',
  regreso: '#6366f1',
  fin_jornada: '#6b7280',
  entrada: '#16a34a',
  salida: '#f59e0b',
  visita_sin_compra: '#a855f7',
}

/**
 * Recuadro de la región de operación (Tacna y alrededores, con holgura).
 *
 * El mapa encuadra todos los puntos que recibe. Basta una coordenada mala para
 * que se abra mostrando medio Perú y los puntos reales queden en un pixel: pasó
 * con marcas que heredaron la ubicación de clientes geocodificados a un punto
 * de la selva. Lo que cae fuera no se dibuja y se avisa al pie.
 */
const REGION = { latMin: -18.6, latMax: -16.9, lonMin: -71.2, lonMax: -69.4 }

const enRegion = (lat: number | null, lon: number | null) =>
  lat != null && lon != null &&
  lat >= REGION.latMin && lat <= REGION.latMax &&
  lon >= REGION.lonMin && lon <= REGION.lonMax

export default function GpsMapPanel({ checkins, clientes }: GpsMapPanelProps) {
  const fueraDeRegion = checkins.filter(
    (c) => c.latitud != null && c.longitud != null && !enRegion(c.latitud, c.longitud)).length
  const sinUbicacion = checkins.filter((c) => c.latitud == null || c.longitud == null).length

  const checkinMarkers: MapMarker[] = checkins
    .filter((c) => enRegion(c.latitud, c.longitud))
    .map((c) => {
      const name = c.profiles?.full_name ?? 'Vendedor'
      const initials = name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
      const hora = new Date(c.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' })
      return {
        id: `ci-${c.id}`,
        lat: Number(c.latitud),
        lng: Number(c.longitud),
        label: name,
        description: `${c.tipo} · ${hora}${c.clientes?.razon_social ? ` · ${c.clientes.razon_social}` : ''}`,
        initials,
        color: COLOR_POR_TIPO[c.tipo] ?? '#16a34a',
      }
    })

  // Mismo filtro para los clientes: nueve tienen coordenadas de una
  // geocodificación fallida y arrastraban el encuadre fuera de Tacna.
  const clienteMarkers: MapMarker[] = clientes
    .filter((c) => enRegion(c.latitud, c.longitud))
    .map((c) => ({
      id: `cli-${c.id}`,
      lat: Number(c.latitud),
      lng: Number(c.longitud),
      label: c.razon_social,
      description: 'Cliente registrado',
      initials: 'C',
      color: '#3b82f6',
    }))

  const allMarkers = [...checkinMarkers, ...clienteMarkers]

  return (
    <Card className="border-gray-200 shadow-sm overflow-hidden">
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <Navigation className="w-4 h-4 text-green-600" />
          Mapa de Seguimiento — Tacna, Perú
        </CardTitle>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-600" /> Entrada</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Salida</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Cliente</span>
        </div>
      </CardHeader>
      <CardContent className="p-3">
        <LeafletMap height="480px" markers={allMarkers} />
        {(fueraDeRegion > 0 || sinUbicacion > 0) && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-2">
            {fueraDeRegion > 0 && (
              <>Hay {fueraDeRegion} marca{fueraDeRegion === 1 ? '' : 's'} con coordenadas fuera de la zona de trabajo; no se dibuja{fueraDeRegion === 1 ? '' : 'n'} para no descuadrar el mapa. </>
            )}
            {sinUbicacion > 0 && (
              <>{sinUbicacion} marca{sinUbicacion === 1 ? '' : 's'} sin señal GPS al registrarse.</>
            )}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-2 text-center">
          {checkinMarkers.length} check-ins · {clienteMarkers.length} clientes geolocalizados
        </p>
      </CardContent>
    </Card>
  )
}
