import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Lo que el agente de impresión viene a buscar.
 *
 * El agente pregunta cada segundo si hay tickets para su equipo. Se identifica
 * con su token, que solo da acceso a su propia cola: si una computadora queda
 * comprometida, no abre nada más del sistema.
 *
 * Es al revés de como estaba antes —el navegador llamando al agente— porque
 * Chrome y Edge están cerrando esa puerta. Acá el que llama es el agente, que
 * es un programa local y no tiene ninguna restricción.
 */

export const dynamic = 'force-dynamic'

// Un solo ticket a la vez: si algo falla, se pierde ese y no toda la tanda
const MAXIMO_POR_VEZ = 3

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')?.trim()
  const version = url.searchParams.get('version')?.trim() ?? null
  /**
   * Por qué ticketera está imprimiendo esa computadora.
   *
   * Lo informa el propio agente. Sirve para ver desde el ERP cuál está
   * conectada pero sin encontrar impresora: antes esa se veía igual que una
   * que funciona, con su punto verde, y no había forma de notarlo hasta que
   * alguien intentaba facturar.
   */
  const detectada = url.searchParams.get('impresora')?.trim() || null

  if (!token) {
    return NextResponse.json({ ok: false, error: 'falta el token del equipo' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: equipo } = await (supabase as any)
    .from('equipos_impresion')
    .select('id, nombre, impresora, activo')
    .eq('token', token)
    .maybeSingle()

  if (!equipo) {
    return NextResponse.json({ ok: false, error: 'equipo no reconocido' }, { status: 401 })
  }
  if (!equipo.activo) {
    return NextResponse.json({ ok: true, equipo: equipo.nombre, trabajos: [] })
  }

  // Deja constancia de que el equipo está vivo: sirve para avisar en el ERP
  // cuando una caja lleva rato sin conectarse.
  await (supabase as any)
    .from('equipos_impresion')
    .update({
      ultima_conexion: new Date().toISOString(),
      version_agente: version,
      impresora_detectada: detectada,
    })
    .eq('id', equipo.id)

  const { data: trabajos, error: falloCola } = await (supabase as any)
    .from('cola_impresion')
    .select('id, contenido, descripcion')
    .eq('equipo_id', equipo.id)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true })
    .limit(MAXIMO_POR_VEZ)

  // Un fallo al leer la cola tiene que verse: si se devuelve una lista vacia,
  // parece que no hay nada que imprimir y el ticket se pierde en silencio.
  if (falloCola) {
    return NextResponse.json(
      { ok: false, error: `no se pudo leer la cola: ${falloCola.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    equipo: equipo.nombre,
    impresora: equipo.impresora ?? null,
    trabajos: trabajos ?? [],
  })
}
