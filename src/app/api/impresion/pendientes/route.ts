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

/*
 * El ritmo de impresión lo pone el servidor, no el agente.
 *
 * El 30/09 se mandaron los 62 comprobantes de un carro a la ticketera de Caja:
 * salieron unos 30 y la impresora se apagó. El agente los había dado a todos
 * por impresos en 86 segundos, porque Windows acepta el trabajo en cuanto lo
 * recibe, no cuando sale el papel. La ticketera quedó imprimiendo sin pausa
 * tickets con logo y QR —mucho negro— y se cortó por temperatura o por la
 * fuente.
 *
 * Así que se entrega de a uno y con aire entre ticket y ticket, y cada tanto
 * una pausa más larga para que el cabezal se enfríe. Un ticket suelto —una
 * venta— sale igual de rápido que antes: la espera solo aparece cuando hay
 * tanda. Se resuelve acá para no tener que reinstalar el agente en cada
 * computadora.
 */
const MAXIMO_POR_VEZ = 1
/** Segundos mínimos entre un ticket y el siguiente del mismo equipo. */
const SEGUNDOS_ENTRE_TICKETS = 4
/** Cada cuántos tickets seguidos se hace la pausa larga… */
const TICKETS_POR_TANDA = 20
/** …y cuántos segundos dura. */
const SEGUNDOS_DE_DESCANSO = 20

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
  /**
   * Todas las impresoras de esa computadora.
   *
   * Cuando la deteccion automatica elige la equivocada —hay maquinas con dos
   * entradas parecidas, la real y una que quedo de antes— Windows acepta el
   * trabajo igual y no sale papel. Teniendo la lista acá, se puede forzar la
   * correcta desde el ERP sin ir hasta la computadora.
   */
  const disponibles = url.searchParams.get('impresoras')?.trim() || null

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
      ...(disponibles ? { impresoras_disponibles: disponibles } : {}),
    })
    .eq('id', equipo.id)

  /*
   * ¿Le toca otro ticket ya, o todavía tiene que descansar?
   *
   * Se miran los últimos impresos de este equipo. Si el último fue hace menos
   * de SEGUNDOS_ENTRE_TICKETS, se espera. Si los últimos TICKETS_POR_TANDA
   * salieron todos seguidos —sin un hueco de descanso entre ellos—, se espera
   * SEGUNDOS_DE_DESCANSO desde el último.
   */
  const { data: recientes } = await (supabase as any)
    .from('cola_impresion')
    .select('impreso_at')
    .eq('equipo_id', equipo.id)
    .eq('estado', 'impreso')
    .gte('impreso_at', new Date(Date.now() - 10 * 60_000).toISOString())
    .order('impreso_at', { ascending: false })
    .limit(TICKETS_POR_TANDA)
  const tiempos = ((recientes ?? []) as { impreso_at: string }[]).map((r) => new Date(r.impreso_at).getTime())
  if (tiempos.length > 0) {
    const desdeElUltimo = (Date.now() - tiempos[0]) / 1000
    if (desdeElUltimo < SEGUNDOS_ENTRE_TICKETS) {
      return NextResponse.json({ ok: true, equipo: equipo.nombre, impresora: equipo.impresora ?? null, trabajos: [] })
    }
    // Una tanda completa sin un descanso en el medio: le toca la pausa larga.
    const tandaSinDescanso = tiempos.length === TICKETS_POR_TANDA
      && tiempos.every((t, i) => i === 0 || (tiempos[i - 1] - t) / 1000 < SEGUNDOS_DE_DESCANSO)
    if (tandaSinDescanso && desdeElUltimo < SEGUNDOS_DE_DESCANSO) {
      return NextResponse.json({ ok: true, equipo: equipo.nombre, impresora: equipo.impresora ?? null, trabajos: [] })
    }
  }

  const { data: trabajos, error: falloCola } = await (supabase as any)
    .from('cola_impresion')
    .select('id, contenido, descripcion')
    .eq('equipo_id', equipo.id)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true })
    // Desempate: dos tickets encolados en el mismo instante salen por número.
    .order('descripcion', { ascending: true })
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
