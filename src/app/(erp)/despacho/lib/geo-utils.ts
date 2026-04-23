export type GeoPoint = { lat: number; lng: number }

/**
 * Distancia haversine entre dos puntos en km.
 */
export function distanciaKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371 // radio de la Tierra en km
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}

export type ParadaRuta<T> = {
  item: T
  secuencia: number
  distancia_km: number
  distancia_acumulada_km: number
}

/**
 * Ordena paradas por nearest-neighbor TSP a partir del punto de inicio (almacén).
 * Complejidad O(n²), suficiente para <100 paradas (caso AGROCAR).
 * Si una parada no tiene coordenadas, queda al final sin optimizar.
 */
export function ordenarPorCercania<T extends { id: string; lat: number | null; lng: number | null }>(
  puntos: T[],
  inicio: GeoPoint,
): ParadaRuta<T>[] {
  const conCoords = puntos.filter((p) => p.lat != null && p.lng != null)
  const sinCoords = puntos.filter((p) => p.lat == null || p.lng == null)

  const resultado: ParadaRuta<T>[] = []
  let cursor: GeoPoint = inicio
  let distanciaAcum = 0
  const pendientes = [...conCoords]

  while (pendientes.length > 0) {
    let idxMin = 0
    let distMin = Infinity
    for (let i = 0; i < pendientes.length; i++) {
      const p = pendientes[i]
      const d = distanciaKm(cursor, { lat: p.lat as number, lng: p.lng as number })
      if (d < distMin) {
        distMin = d
        idxMin = i
      }
    }
    const elegido = pendientes.splice(idxMin, 1)[0]
    distanciaAcum += distMin
    resultado.push({
      item: elegido,
      secuencia: resultado.length + 1,
      distancia_km: Number(distMin.toFixed(3)),
      distancia_acumulada_km: Number(distanciaAcum.toFixed(3)),
    })
    cursor = { lat: elegido.lat as number, lng: elegido.lng as number }
  }

  // Paradas sin coordenadas al final
  for (const p of sinCoords) {
    resultado.push({
      item: p,
      secuencia: resultado.length + 1,
      distancia_km: 0,
      distancia_acumulada_km: distanciaAcum,
    })
  }

  return resultado
}

/**
 * Agrupa pedidos por campo zona_id o distrito (el que esté presente).
 * Retorna Map<string, T[]>.
 */
export function agruparPorZona<T extends { zona_id?: string | null; distrito?: string | null }>(
  items: T[],
): Map<string, T[]> {
  const grupos = new Map<string, T[]>()
  for (const it of items) {
    const key = it.zona_id || it.distrito || 'sin-zona'
    const arr = grupos.get(key) ?? []
    arr.push(it)
    grupos.set(key, arr)
  }
  return grupos
}

/**
 * Color estable basado en un string (para distinguir vehículos en el mapa).
 */
export function colorDeString(s: string): string {
  const colores = ['#2563eb', '#dc2626', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#db2777', '#65a30d']
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  return colores[hash % colores.length]
}
