import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface DniResult {
  dni: string
  nombres: string
  apellidoPaterno?: string | null
  apellidoMaterno?: string | null
  nombreCompleto: string
}

async function consultarApisNetPe(dni: string): Promise<DniResult | null> {
  try {
    const res = await fetch(`https://api.apis.net.pe/v2/reniec/dni?numero=${dni}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const d = await res.json()
    if (!d?.nombres) return null
    const nombreCompleto = [d.nombres, d.apellidoPaterno, d.apellidoMaterno]
      .filter(Boolean)
      .join(' ')
    return {
      dni: d.numeroDocumento ?? dni,
      nombres: d.nombres,
      apellidoPaterno: d.apellidoPaterno ?? null,
      apellidoMaterno: d.apellidoMaterno ?? null,
      nombreCompleto,
    }
  } catch {
    return null
  }
}

async function consultarDecolecta(dni: string): Promise<DniResult | null> {
  try {
    const res = await fetch(`https://api.decolecta.com/v1/reniec/dni?numero=${dni}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const d = await res.json()
    const nombres = d.nombres ?? d.first_name
    if (!nombres) return null
    const apPat = d.apellido_paterno ?? d.apellidoPaterno ?? null
    const apMat = d.apellido_materno ?? d.apellidoMaterno ?? null
    return {
      dni: d.dni ?? dni,
      nombres,
      apellidoPaterno: apPat,
      apellidoMaterno: apMat,
      nombreCompleto: [nombres, apPat, apMat].filter(Boolean).join(' '),
    }
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const dni = (searchParams.get('numero') ?? '').trim()

  if (!/^\d{8}$/.test(dni)) {
    return NextResponse.json(
      { error: 'DNI inválido. Debe tener 8 dígitos.' },
      { status: 400 },
    )
  }

  const result =
    (await consultarApisNetPe(dni)) ?? (await consultarDecolecta(dni))

  if (!result) {
    return NextResponse.json(
      { error: 'No se pudo consultar RENIEC. Intenta nuevamente en unos segundos.' },
      { status: 502 },
    )
  }

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
