import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * De qué computadora es un código.
 *
 * La usa el instalador del agente para mostrar, antes de instalar, el nombre
 * de la computadora a la que corresponde el código pegado. Cada máquina tiene
 * el suyo, y como el instalador toma lo que haya en el portapapeles es fácil
 * llegar con el de otra: dos agentes con el mismo código escuchan la misma
 * cola y los tickets salen donde no son.
 *
 * No devuelve trabajos ni toca nada: solo confirma a quién pertenece.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')?.trim()
  if (!token) {
    return NextResponse.json({ ok: false, error: 'falta el código' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: equipo } = await (supabase as any)
    .from('equipos_impresion')
    .select('nombre, activo')
    .eq('token', token)
    .maybeSingle()

  if (!equipo) {
    return NextResponse.json(
      { ok: false, error: 'Ese código no corresponde a ninguna computadora registrada' },
      { status: 404 },
    )
  }

  return NextResponse.json({ ok: true, equipo: equipo.nombre, activo: equipo.activo })
}
