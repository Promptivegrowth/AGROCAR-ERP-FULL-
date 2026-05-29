import type { SupabaseClient } from '@supabase/supabase-js'

export interface SaldoCliente {
  facturado: number       // Suma de comprobantes (facturas + boletas) no anulados
  cobrado: number         // Suma de cobros aplicados
  notas_credito: number   // Suma de NC de venta (futuro; por ahora 0)
  saldo: number           // facturado − cobrado − notas_credito
}

/**
 * Calcula el saldo pendiente de un cliente.
 *
 * Saldo = comprobantes facturados − cobros recibidos − notas de crédito emitidas
 *
 * Excluye `comprobantes.id` si se pasa, útil cuando estamos viendo un cobro
 * específico y queremos saber el saldo previo (sin contar el cobro actual).
 */
export async function getSaldoCliente(
  supabase: SupabaseClient<any>,
  clienteId: string,
  opts?: { excluirCobroId?: string },
): Promise<SaldoCliente> {
  const [{ data: comps }, { data: cobs }] = await Promise.all([
    supabase
      .from('comprobantes')
      .select('total')
      .eq('cliente_id', clienteId)
      .neq('estado', 'anulado'),
    (() => {
      let q = supabase
        .from('cobros')
        .select('id, total')
        .eq('cliente_id', clienteId)
      if (opts?.excluirCobroId) q = q.neq('id', opts.excluirCobroId)
      return q
    })(),
  ])

  const facturado = (comps ?? []).reduce((acc: number, c: any) => acc + Number(c.total ?? 0), 0)
  const cobrado = (cobs ?? []).reduce((acc: number, c: any) => acc + Number(c.total ?? 0), 0)
  // NC de venta aún no implementada (no hay tabla notas_credito_venta).
  // Cuando se implemente, sumar aquí.
  const notas_credito = 0
  const saldo = Math.max(0, facturado - cobrado - notas_credito)

  return { facturado, cobrado, notas_credito, saldo }
}

/**
 * Calcula los días desde la fecha de vencimiento de un comprobante.
 * Devuelve -∞ (Number.NEGATIVE_INFINITY) si no hay fecha.
 */
export function diasVencidos(fechaEmision: string | null, creditoDias: number | null): number {
  if (!fechaEmision || creditoDias == null) return Number.NEGATIVE_INFINITY
  const emision = new Date(fechaEmision + 'T00:00:00')
  const vencimiento = new Date(emision)
  vencimiento.setDate(vencimiento.getDate() + Number(creditoDias))
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const diff = hoy.getTime() - vencimiento.getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

/**
 * Calcula fecha de vencimiento de un comprobante (texto formateado).
 */
export function fechaVencimientoTexto(fechaEmision: string | null, creditoDias: number | null): string | null {
  if (!fechaEmision || creditoDias == null) return null
  const emision = new Date(fechaEmision + 'T00:00:00')
  emision.setDate(emision.getDate() + Number(creditoDias))
  return emision.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
