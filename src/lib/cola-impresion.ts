/**
 * Envío de tickets a la cola de impresión.
 *
 * El ERP deja el ticket en la base y el agente de la computadora elegida lo
 * levanta y lo imprime, normalmente en menos de un segundo.
 *
 * Antes el navegador le hablaba directo al agente por una dirección local, pero
 * Chrome y Edge están cerrando esa puerta —bloquean que una página de internet
 * se comunique con programas de la propia computadora—. Con la cola el
 * navegador no toca la impresora, así que esa restricción deja de importar y no
 * hay que tocar la configuración de cada equipo.
 */

import { createClient } from '@/lib/supabase/client'

/** Equipo elegido en este navegador; se recuerda para no preguntar cada vez. */
const CLAVE_EQUIPO = 'agrocar.equipo-impresion'

export type Equipo = {
  id: string
  nombre: string
  activo: boolean
  ultima_conexion: string | null
  /**
   * Milímetros que adelanta el papel antes de cortar, propios de esa
   * ticketera: la cuchilla no está a la misma distancia del cabezal en todos
   * los modelos.
   */
  avance_corte_mm: number | null
}

export function equipoElegido(): string | null {
  try {
    return localStorage.getItem(CLAVE_EQUIPO)
  } catch {
    return null
  }
}

export function guardarEquipo(id: string) {
  try {
    localStorage.setItem(CLAVE_EQUIPO, id)
  } catch {
    /* modo privado */
  }
}

/** Equipos disponibles para imprimir, el conectado primero. */
export async function equiposDisponibles(): Promise<Equipo[]> {
  const supabase = createClient()
  const { data } = await (supabase as any)
    .from('equipos_impresion')
    .select('id, nombre, activo, ultima_conexion, avance_corte_mm')
    .eq('activo', true)
    .order('nombre')
  const lista = (data ?? []) as Equipo[]
  return lista.sort((a, b) => Number(conectado(b)) - Number(conectado(a)))
}

/** Un equipo cuenta como conectado si dio señales en el último minuto. */
export function conectado(e: Equipo): boolean {
  if (!e?.ultima_conexion) return false
  return Date.now() - new Date(e.ultima_conexion).getTime() < 60_000
}

export type ResultadoCola =
  | { ok: true; id: string }
  | { ok: false; error: string }

/**
 * Deja un ticket esperando a que el agente lo imprima.
 *
 * `contenidoBase64` son los bytes ESC/POS ya armados: el formato vive en el
 * ERP, así que se puede cambiar el diseño del ticket actualizando el sistema
 * sin reinstalar nada en las computadoras.
 */
export async function encolarTicket(
  contenidoBase64: string,
  equipoId: string,
  descripcion?: string,
): Promise<ResultadoCola> {
  const supabase = createClient()
  const { data: sesion } = await supabase.auth.getUser()

  const { data, error } = await (supabase as any)
    .from('cola_impresion')
    .insert({
      equipo_id: equipoId,
      contenido: contenidoBase64,
      descripcion: descripcion ?? null,
      creado_por: sesion?.user?.id ?? null,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, id: data.id }
}

/**
 * Espera a que el agente confirme.
 *
 * Sirve para poder decir "impreso" y no solo "enviado": si la ticketera está
 * apagada o sin papel, el cajero tiene que enterarse en el momento y no cuando
 * el cliente ya se fue.
 */
export async function esperarImpresion(id: string, segundos = 12): Promise<'impreso' | 'error' | 'esperando'> {
  const supabase = createClient()
  const hasta = Date.now() + segundos * 1000

  while (Date.now() < hasta) {
    const { data } = await (supabase as any)
      .from('cola_impresion')
      .select('estado')
      .eq('id', id)
      .maybeSingle()

    if (data?.estado === 'impreso') return 'impreso'
    if (data?.estado === 'error') return 'error'
    await new Promise((r) => setTimeout(r, 700))
  }
  return 'esperando'
}
