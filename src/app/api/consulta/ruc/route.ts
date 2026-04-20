import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export interface RucResult {
  ruc: string
  razonSocial: string
  nombreComercial?: string | null
  estado?: string | null
  condicion?: string | null
  direccion?: string | null
  direccionCompleta?: string | null
  ubigeo?: string | null
  departamento?: string | null
  provincia?: string | null
  distrito?: string | null
  viaTipo?: string | null
  viaNombre?: string | null
  numero?: string | null
  esAgenteRetencion?: boolean | null
  esBuenContribuyente?: boolean | null
}

function construirDireccionLimpia(d: any): string | null {
  // Primero intentar con los campos estructurados
  if (d.via_tipo && d.via_nombre) {
    const partes = [
      d.via_tipo,
      d.via_nombre,
      d.numero && d.numero !== '-' ? d.numero : null,
      d.interior && d.interior !== '-' ? `Int. ${d.interior}` : null,
      d.manzana && d.manzana !== '-' ? `Mz. ${d.manzana}` : null,
      d.lote && d.lote !== '-' ? `Lt. ${d.lote}` : null,
    ].filter(Boolean)
    if (partes.length >= 2) return partes.join(' ')
  }
  // Fallback: dirección cruda limpia
  if (d.direccion) {
    return String(d.direccion)
      .replace(/\s+/g, ' ')
      .replace(/\s+-\s*/g, ' ')
      .trim()
  }
  return null
}

async function consultarDecolecta(ruc: string, token: string): Promise<RucResult | null> {
  try {
    const res = await fetch(`https://api.decolecta.com/v1/sunat/ruc?numero=${ruc}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const d = await res.json()
    const razon = d.razon_social ?? d.razonSocial
    if (!razon) return null
    return {
      ruc: d.numero_documento ?? d.ruc ?? ruc,
      razonSocial: String(razon).trim(),
      nombreComercial: d.nombre_comercial ?? null,
      estado: d.estado ?? null,
      condicion: d.condicion ?? null,
      direccion: construirDireccionLimpia(d),
      direccionCompleta: d.direccion ? String(d.direccion).trim() : null,
      ubigeo: d.ubigeo ?? null,
      departamento: d.departamento ?? null,
      provincia: d.provincia ?? null,
      distrito: d.distrito ?? null,
      viaTipo: d.via_tipo ?? null,
      viaNombre: d.via_nombre ?? null,
      numero: d.numero && d.numero !== '-' ? d.numero : null,
      esAgenteRetencion: d.es_agente_retencion ?? null,
      esBuenContribuyente: d.es_buen_contribuyente ?? null,
    }
  } catch {
    return null
  }
}

async function consultarApisPeru(ruc: string, token: string): Promise<RucResult | null> {
  try {
    const res = await fetch(
      `https://dniruc.apisperu.com/api/v1/ruc/${ruc}?token=${token}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return null
    const d = await res.json()
    if (!d?.ruc || !d?.razonSocial) return null
    return {
      ruc: d.ruc,
      razonSocial: d.razonSocial,
      nombreComercial: null,
      estado: d.estado ?? null,
      condicion: d.condicion ?? null,
      direccion: d.direccion ?? null,
      direccionCompleta: d.direccion ?? null,
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
    return NextResponse.json({ error: 'RUC inválido. Debe tener 11 dígitos.' }, { status: 400 })
  }

  const sunatToken = process.env.SUNAT_TOKEN
  const apisperuToken = process.env.APISPERU_TOKEN

  if (!sunatToken && !apisperuToken) {
    return NextResponse.json(
      { error: 'SUNAT_TOKEN no configurado en el servidor.' },
      { status: 503 },
    )
  }

  let result: RucResult | null = null
  if (sunatToken) result = await consultarDecolecta(ruc, sunatToken)
  if (!result && apisperuToken) result = await consultarApisPeru(ruc, apisperuToken)

  if (!result) {
    return NextResponse.json(
      { error: 'No se pudo consultar SUNAT. Verifica el RUC e intenta más tarde.' },
      { status: 502 },
    )
  }

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
  })
}
