import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface DniResult {
  dni: string
  nombres: string
  apellidoPaterno?: string | null
  apellidoMaterno?: string | null
  nombreCompleto: string
}

async function consultarDecolecta(dni: string, token: string): Promise<DniResult | null> {
  try {
    const res = await fetch(`https://api.decolecta.com/v1/reniec/dni?numero=${dni}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const d = await res.json()
    const nombres = d.first_name ?? d.nombres
    if (!nombres) return null
    const apPat = d.first_last_name ?? d.apellido_paterno ?? d.apellidoPaterno ?? null
    const apMat = d.second_last_name ?? d.apellido_materno ?? d.apellidoMaterno ?? null
    const full = d.full_name ?? [apPat, apMat, nombres].filter(Boolean).join(' ')
    return {
      dni: d.document_number ?? d.dni ?? dni,
      nombres,
      apellidoPaterno: apPat,
      apellidoMaterno: apMat,
      nombreCompleto: full.trim(),
    }
  } catch {
    return null
  }
}

async function consultarApisPeru(dni: string, token: string): Promise<DniResult | null> {
  try {
    const res = await fetch(
      `https://dniruc.apisperu.com/api/v1/dni/${dni}?token=${token}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return null
    const d = await res.json()
    if (!d?.nombres) return null
    const full = [d.apellidoPaterno, d.apellidoMaterno, d.nombres].filter(Boolean).join(' ')
    return {
      dni: d.dni ?? dni,
      nombres: d.nombres,
      apellidoPaterno: d.apellidoPaterno ?? null,
      apellidoMaterno: d.apellidoMaterno ?? null,
      nombreCompleto: full,
    }
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const dni = (searchParams.get('numero') ?? '').trim()

  if (!/^\d{8}$/.test(dni)) {
    return NextResponse.json({ error: 'DNI inválido. Debe tener 8 dígitos.' }, { status: 400 })
  }

  const sunatToken = process.env.SUNAT_TOKEN
  const apisperuToken = process.env.APISPERU_TOKEN

  if (!sunatToken && !apisperuToken) {
    return NextResponse.json(
      { error: 'SUNAT_TOKEN no configurado en el servidor.' },
      { status: 503 },
    )
  }

  let result: DniResult | null = null
  if (sunatToken) result = await consultarDecolecta(dni, sunatToken)
  if (!result && apisperuToken) result = await consultarApisPeru(dni, apisperuToken)

  if (!result) {
    return NextResponse.json(
      { error: 'No se pudo consultar RENIEC. Verifica el DNI e intenta más tarde.' },
      { status: 502 },
    )
  }

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
  })
}
