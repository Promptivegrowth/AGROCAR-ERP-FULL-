import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hoyLima } from '@/lib/fechas-pe'

export const dynamic = 'force-dynamic'

interface TipoCambioData {
  fecha: string // YYYY-MM-DD
  compra: number
  venta: number
  fuente: string
}

async function fetchDecolecta(token: string): Promise<TipoCambioData | null> {
  try {
    const res = await fetch('https://api.decolecta.com/v1/tipo-cambio/sunat', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const d = await res.json()
    const compra = Number(d.buy_price ?? d.compra)
    const venta = Number(d.sell_price ?? d.venta)
    if (!Number.isFinite(compra) || !Number.isFinite(venta)) return null
    return {
      fecha: d.date ?? hoyLima(),
      compra,
      venta,
      fuente: 'SUNAT (Decolecta)',
    }
  } catch {
    return null
  }
}

/**
 * GET /api/tipo-cambio
 *   ?refresh=1 → fuerza consulta a la API y guarda en DB
 * Sin refresh: devuelve el TC vigente (última fila en DB o consulta si no hay del día)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const refresh = searchParams.get('refresh') === '1'

  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
  const supabase = createAdminClient()

  // Ver si ya tenemos TC de hoy y el refresh no está forzado
  if (!refresh) {
    const { data: existing } = await supabase
      .from('tipo_cambio')
      .select('fecha, compra, venta, fuente')
      .eq('fecha', hoy)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(existing, {
        headers: { 'Cache-Control': 'public, max-age=600' },
      })
    }
  }

  const token = process.env.SUNAT_TOKEN
  if (!token) {
    return NextResponse.json(
      { error: 'SUNAT_TOKEN no configurado en el servidor.' },
      { status: 503 },
    )
  }

  const data = await fetchDecolecta(token)
  if (!data) {
    return NextResponse.json(
      { error: 'No se pudo consultar el tipo de cambio.' },
      { status: 502 },
    )
  }

  // Guardar/actualizar (upsert por fecha)
  const { error: upsertError } = await (supabase.from('tipo_cambio') as any).upsert(
    {
      fecha: data.fecha,
      compra: data.compra,
      venta: data.venta,
      fuente: data.fuente,
    },
    { onConflict: 'fecha' },
  )
  if (upsertError) {
    console.error('Error guardando TC:', upsertError)
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, max-age=600' },
  })
}

/**
 * POST /api/tipo-cambio  → equivalente a GET?refresh=1, pensado para cron.
 */
export async function POST(req: Request) {
  const url = new URL(req.url)
  url.searchParams.set('refresh', '1')
  return GET(new Request(url.toString(), { method: 'GET', headers: req.headers }))
}
