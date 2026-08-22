import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * El agente avisa qué pasó con cada ticket.
 *
 * Se marca impreso o con error, y en este segundo caso queda el motivo para
 * poder verlo desde el ERP: un ticket que no salió tiene que ser visible, no
 * desaparecer en silencio.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let cuerpo: any
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'cuerpo inválido' }, { status: 400 })
  }

  const token = String(cuerpo?.token ?? '').trim()
  const id = String(cuerpo?.id ?? '').trim()
  const ok = cuerpo?.ok === true
  const error = cuerpo?.error ? String(cuerpo.error).slice(0, 300) : null

  if (!token || !id) {
    return NextResponse.json({ ok: false, error: 'faltan datos' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: equipo } = await (supabase as any)
    .from('equipos_impresion')
    .select('id')
    .eq('token', token)
    .maybeSingle()

  if (!equipo) {
    return NextResponse.json({ ok: false, error: 'equipo no reconocido' }, { status: 401 })
  }

  // El equipo_id en el filtro evita que un agente toque trabajos de otra caja
  const { error: fallo } = await (supabase as any)
    .from('cola_impresion')
    .update({
      estado: ok ? 'impreso' : 'error',
      error,
      impreso_at: ok ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .eq('equipo_id', equipo.id)

  if (fallo) {
    return NextResponse.json({ ok: false, error: fallo.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
