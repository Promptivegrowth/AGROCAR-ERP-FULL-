'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * La tasa de IGV, leída de la configuración.
 *
 * Hasta ahora el 18% estaba escrito a mano en cada pantalla que calcula un
 * importe. Daniel pidió poder cambiarlo —"habilitar en configuración una opción
 * para cambiar el IGV"— y cambiarlo solo sirve si todos lo leen del mismo lado.
 *
 * La tasa va como porcentaje: 18 significa 18%.
 *
 * Quien manda es la base: las funciones que emiten y recalculan usan
 * `igv_vigente()`. Esto es para que la pantalla muestre lo mismo que la base va
 * a guardar, no para decidir nada.
 */

/** Lo que rige en Perú desde 2011, y lo que se usa si algo falla. */
export const IGV_POR_OMISION = 18

/**
 * Una sola consulta por sesión.
 *
 * Todas las pantallas que calculan IGV piden lo mismo, y la tasa no cambia
 * entre dos renglones de una factura. Se guarda la promesa —no el valor— para
 * que dos llamadas simultáneas compartan la misma consulta.
 */
let pendiente: Promise<number> | null = null

export function leerIgv(): Promise<number> {
  if (!pendiente) {
    pendiente = (async () => {
      try {
        const supabase = createClient()
        const { data } = await (supabase as any)
          .from('configuracion').select('valor').eq('clave', 'igv_porcentaje').maybeSingle()
        return normalizarIgv((data as { valor?: string } | null)?.valor)
      } catch {
        return IGV_POR_OMISION
      }
    })()
  }
  return pendiente
}

/** Que un dato mal escrito no deje de facturar: fuera de rango, se usa 18. */
export function normalizarIgv(valor: unknown): number {
  const n = Number(String(valor ?? '').trim())
  if (!Number.isFinite(n) || n < 0 || n > 50) return IGV_POR_OMISION
  return n
}

/** Olvidar lo leído, para que la próxima consulta traiga el valor nuevo. */
export function olvidarIgv() {
  pendiente = null
}

/**
 * La tasa para usar en una pantalla.
 *
 * Arranca en 18 y se corrige sola cuando llega la consulta. Mientras tanto
 * muestra la tasa de siempre, que es la correcta salvo que alguien la haya
 * cambiado hace un instante.
 */
export function useIgv(): number {
  const [igv, setIgv] = useState(IGV_POR_OMISION)
  useEffect(() => {
    let vivo = true
    leerIgv().then((v) => { if (vivo) setIgv(v) })
    return () => { vivo = false }
  }, [])
  return igv
}

/** El factor para desagregar un precio que ya incluye IGV: 18 → 1.18. */
export const factorIgv = (igv: number) => 1 + igv / 100

/** El IGV contenido en un importe que ya lo incluye. */
export function igvContenido(totalConIgv: number, igv: number): number {
  return Math.round((totalConIgv - totalConIgv / factorIgv(igv)) * 100) / 100
}
