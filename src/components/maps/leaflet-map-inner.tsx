'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, LayersControl } from 'react-leaflet'
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

interface LeafletMapInnerProps {
  center?: [number, number]
  zoom?: number
  height?: string
  markers?: MapMarker[]
  pickable?: boolean
  pickedPosition?: [number, number] | null
  onPick?: (lat: number, lng: number) => void
  fitBounds?: boolean
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
  pickable = false,
  pickedPosition = null,
  onPick,
  fitBounds = true,
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
        {fitBounds && <FitBounds markers={markers} pickedPosition={pickedPosition} />}
      </MapContainer>
    </div>
  )
}
