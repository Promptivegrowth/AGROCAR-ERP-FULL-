import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface GeocodeResult {
  lat: number
  lng: number
  displayName: string
  confianza: 'alta' | 'media' | 'baja'
}

function limpiarDireccionSunat(raw: string): string {
  return raw
    .replace(/\bNRO\.?\s*/gi, '')
    .replace(/\bCAL\.\s*/gi, 'Calle ')
    .replace(/\bAV\.\s*/gi, 'Avenida ')
    .replace(/\bJR\.\s*/gi, 'Jirón ')
    .replace(/\bPSJE\.\s*/gi, 'Pasaje ')
    .replace(/\bMZ\.?\s*/gi, 'Manzana ')
    .replace(/\bLT\.?\s*/gi, 'Lote ')
    .replace(/\bCPM\s+/gi, '')
    .replace(/\bFND\.\s*/gi, 'Fundo ')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function consultarNominatim(query: string): Promise<GeocodeResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=pe&addressdetails=1`
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AgrocarERP/1.0 (contacto@agrocar.pe)',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const arr = await res.json()
    if (!Array.isArray(arr) || arr.length === 0) return null
    const item = arr[0]
    const lat = Number(item.lat)
    const lng = Number(item.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    const importance = Number(item.importance ?? 0)
    const confianza: 'alta' | 'media' | 'baja' =
      importance > 0.5 ? 'alta' : importance > 0.2 ? 'media' : 'baja'
    return {
      lat,
      lng,
      displayName: item.display_name ?? query,
      confianza,
    }
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const direccion = (searchParams.get('direccion') ?? '').trim()
  const distrito = (searchParams.get('distrito') ?? '').trim()
  const provincia = (searchParams.get('provincia') ?? '').trim()
  const departamento = (searchParams.get('departamento') ?? '').trim()

  if (!direccion && !distrito) {
    return NextResponse.json({ error: 'Se requiere dirección o distrito.' }, { status: 400 })
  }

  const dirLimpia = direccion ? limpiarDireccionSunat(direccion) : ''

  // Intento 1: dirección completa + ubicación
  const queries = [
    [dirLimpia, distrito, provincia, departamento, 'Perú'].filter(Boolean).join(', '),
    [dirLimpia, distrito, 'Perú'].filter(Boolean).join(', '),
    [distrito, provincia, departamento, 'Perú'].filter(Boolean).join(', '),
  ].filter((q, i, arr) => q && arr.indexOf(q) === i)

  for (const q of queries) {
    const r = await consultarNominatim(q)
    if (r) {
      return NextResponse.json(r, {
        headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
      })
    }
  }

  return NextResponse.json({ error: 'No se encontró la ubicación.' }, { status: 404 })
}
