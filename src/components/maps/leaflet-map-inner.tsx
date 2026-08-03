'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, CircleMarker, Tooltip, useMap, useMapEvents, LayersControl } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default marker icons (Next.js bundler strips the default paths)
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Ícono verde AGROCAR para vendedores
export const greenIcon = new L.DivIcon({
  className: '',
  html: `
    <div style="
      width: 34px; height: 34px; background: #16a34a;
      border: 3px solid white; border-radius: 50%;
      box-shadow: 0 4px 8px rgba(0,0,0,0.25);
      display: flex; align-items: center; justify-content: center;
      color: white; font-weight: bold; font-size: 11px;
      font-family: system-ui, sans-serif;
    "></div>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17],
})

export function makeInitialsIcon(initials: string, color = '#16a34a') {
  return new L.DivIcon({
    className: '',
    html: `
      <div style="
        width: 38px; height: 38px; background: ${color};
        border: 3px solid white; border-radius: 50%;
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        display: flex; align-items: center; justify-content: center;
        color: white; font-weight: bold; font-size: 12px;
        font-family: system-ui, sans-serif;
      ">${initials}</div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -19],
  })
}

export interface MapMarker {
  id: string
  lat: number
  lng: number
  label?: string
  description?: string
  initials?: string
  color?: string
  onClick?: () => void
}

export interface MapPolyline {
  id: string
  positions: [number, number][]
  color?: string
  dashed?: boolean
}

/**
 * Círculo de tamaño proporcional para el análisis zonificado: el radio se da
 * en píxeles, así el punto conserva su tamaño relativo aunque se haga zoom.
 */
export interface MapCircle {
  id: string
  lat: number
  lng: number
  radiusPx: number
  color?: string
  /** Atenuado cuando hay otro seleccionado */
  dimmed?: boolean
  /** Borde punteado: la ubicación es aproximada */
  approximate?: boolean
  label?: string
  value?: string
  onClick?: () => void
}

/** Círculo de alcance: engloba un grupo de zonas cercanas */
export interface MapCoverage {
  lat: number
  lng: number
  radiusMeters: number
  color?: string
}

interface LeafletMapInnerProps {
  center?: [number, number]
  zoom?: number
  height?: string
  markers?: MapMarker[]
  polylines?: MapPolyline[]
  circles?: MapCircle[]
  coverage?: MapCoverage | null
  pickable?: boolean
  pickedPosition?: [number, number] | null
  onPick?: (lat: number, lng: number) => void
  fitBounds?: boolean
  flyTo?: { lat: number; lng: number; zoom?: number; key?: string | number } | null
}

/** Ajusta la vista para que entren todos los círculos */
function FitCircles({ circles }: { circles?: MapCircle[] }) {
  const map = useMap()
  const clave = (circles ?? []).map((c) => `${c.lat},${c.lng}`).join('|')
  useEffect(() => {
    if (!circles || circles.length === 0) return
    const pts = circles.map((c) => [c.lat, c.lng] as [number, number])
    if (pts.length === 1) map.setView(pts[0], 13)
    else map.fitBounds(pts, { padding: [50, 50], maxZoom: 14 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, map])
  return null
}

function FlyTo({ target }: { target?: { lat: number; lng: number; zoom?: number; key?: string | number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], target.zoom ?? 17, { duration: 0.8 })
  }, [target?.lat, target?.lng, target?.zoom, target?.key, map, target])
  return null
}

function LocationPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function FitBounds({ markers, pickedPosition }: { markers?: MapMarker[]; pickedPosition?: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    const pts: [number, number][] = []
    markers?.forEach((m) => pts.push([m.lat, m.lng]))
    if (pickedPosition) pts.push(pickedPosition)
    if (pts.length === 0) return
    if (pts.length === 1) {
      map.setView(pts[0], 15)
    } else {
      map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 })
    }
  }, [markers, pickedPosition, map])
  return null
}

export default function LeafletMapInner({
  center = [-18.0066, -70.2462], // Tacna por defecto
  zoom = 13,
  height = '420px',
  markers = [],
  polylines = [],
  circles = [],
  coverage = null,
  pickable = false,
  pickedPosition = null,
  onPick,
  fitBounds = true,
  flyTo = null,
}: LeafletMapInnerProps) {
  return (
    <div style={{ height, width: '100%' }} className="rounded-xl overflow-hidden">
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer name="Calles (ESRI)" checked>
            <TileLayer
              attribution='Tiles &copy; Esri &mdash; Street Map'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satélite (ESRI)">
            <TileLayer
              attribution='Tiles &copy; Esri &mdash; Imagery'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OpenStreetMap">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="CartoDB Voyager">
            <TileLayer
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        {/* Círculo de alcance: agrupa las zonas cercanas */}
        {coverage && (
          <Circle
            center={[coverage.lat, coverage.lng]}
            radius={coverage.radiusMeters}
            pathOptions={{
              color: coverage.color ?? '#dc2626',
              weight: 2,
              opacity: 0.7,
              fillOpacity: 0.04,
            }}
          />
        )}

        {/* Puntos proporcionales por zona */}
        {circles.map((c) => (
          <CircleMarker
            key={c.id}
            center={[c.lat, c.lng]}
            radius={c.radiusPx}
            pathOptions={{
              color: c.color ?? '#F59E0B',
              weight: c.approximate ? 2 : 1,
              dashArray: c.approximate ? '4 3' : undefined,
              opacity: c.dimmed ? 0.35 : 0.95,
              fillColor: c.color ?? '#F59E0B',
              fillOpacity: c.dimmed ? 0.2 : 0.85,
            }}
            eventHandlers={c.onClick ? { click: c.onClick } : undefined}
          >
            {(c.label || c.value) && (
              <Tooltip direction="top" offset={[0, -4]}>
                <div style={{ fontSize: 12 }}>
                  {c.label && <div style={{ fontWeight: 700 }}>{c.label}</div>}
                  {c.value && <div>{c.value}</div>}
                  {c.approximate && (
                    <div style={{ color: '#b45309', fontSize: 10 }}>Ubicación aproximada</div>
                  )}
                </div>
              </Tooltip>
            )}
          </CircleMarker>
        ))}

        {polylines.map((pl) => (
          <Polyline
            key={pl.id}
            positions={pl.positions}
            pathOptions={{
              color: pl.color ?? '#2563eb',
              weight: 3,
              opacity: 0.75,
              dashArray: pl.dashed ? '6 6' : undefined,
            }}
          />
        ))}
        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={m.initials ? makeInitialsIcon(m.initials, m.color) : greenIcon}
            eventHandlers={m.onClick ? { click: m.onClick } : undefined}
          >
            {(m.label || m.description) && (
              <Popup>
                <div className="text-sm">
                  {m.label && <p className="font-semibold text-gray-800">{m.label}</p>}
                  {m.description && <p className="text-gray-600 text-xs mt-1">{m.description}</p>}
                  <p className="text-gray-400 text-[10px] mt-1 font-mono">
                    {m.lat.toFixed(5)}, {m.lng.toFixed(5)}
                  </p>
                </div>
              </Popup>
            )}
          </Marker>
        ))}
        {pickable && pickedPosition && (
          <Marker position={pickedPosition} icon={greenIcon}>
            <Popup>Ubicación seleccionada</Popup>
          </Marker>
        )}
        {pickable && onPick && <LocationPicker onPick={onPick} />}
        {fitBounds && !flyTo && markers.length > 0 && (
          <FitBounds markers={markers} pickedPosition={pickedPosition} />
        )}
        {fitBounds && !flyTo && markers.length === 0 && circles.length > 0 && (
          <FitCircles circles={circles} />
        )}
        <FlyTo target={flyTo} />
      </MapContainer>
    </div>
  )
}
