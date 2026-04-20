import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Proxy gratuito a SUNAT vía apis.net.pe (sin API key, rate-limited)
// Fallback a decolecta si la primera falla.

interface RucResult {
  ruc: string
  razonSocial: string
  nombreComercial?: string | null
  estado?: string | null
  condicion?: string | null
  direccion?: string | null
  ubigeo?: string | null
  departamento?: string | null
  provincia?: string | null
  distrito?: string | null
}

async function consultarApisNetPe(ruc: string): Promise<RucResult | null> {
  try {
    const res = await fetch(`https://api.apis.net.pe/v2/sunat/ruc?numero=${ruc}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const d = await res.json()
    if (!d?.razonSocial) return null
    return {
      ruc: d.numeroDocumento ?? ruc,
      razonSocial: d.razonSocial,
      nombreComercial: d.nombreComercial ?? null,
      estado: d.estado ?? null,
      condicion: d.condicion ?? null,
      direccion: d.direccion ?? null,
      ubigeo: d.ubigeo ?? null,
      departamento: d.departamento ?? null,
      provincia: d.provincia ?? null,
      distrito: d.distrito ?? null,
    }
  } catch {
    return null
  }
}

async function consultarDecolecta(ruc: string): Promise<RucResult | null> {
  try {
    const res = await fetch(`https://api.decolecta.com/v1/sunat/ruc?numero=${ruc}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const d = await res.json()
    if (!d?.razon_social && !d?.razonSocial) return null
    return {
      ruc: d.ruc ?? ruc,
      razonSocial: d.razon_social ?? d.razonSocial,
      nombreComercial: d.nombre_comercial ?? null,
      estado: d.estado ?? null,
      condicion: d.condicion ?? null,
      direccion: d.direccion ?? null,
      departamento: d.departamento ?? null,
      provincia: d.provincia ?? null,
      distrito: d.distrito ?? null,
    }
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const ruc = (searchParams.get('numero') ?? '').trim()

  if (!/^\d{11}$/.test(ruc)) {
    return NextResponse.json(
      { error: 'RUC inválido. Debe tener 11 dígitos.' },
      { status: 400 },
    )
  }

  const result =
    (await consultarApisNetPe(ruc)) ?? (await consultarDecolecta(ruc))

  if (!result) {
    return NextResponse.json(
      { error: 'No se pudo consultar SUNAT. Intenta nuevamente en unos segundos.' },
      { status: 502 },
    )
  }

  return NextResponse.json(result, {
    headers: {
      // Cachear 1h en edge para aliviar el rate limit
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
