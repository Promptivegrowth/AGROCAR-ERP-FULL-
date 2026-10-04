/**
 * Contado o crédito, y cuándo vence: una sola regla para el papel y para SUNAT.
 *
 * Daniel, 03/10: "en la impresión de boletas y facturas está imprimiendo por
 * defecto crédito, y de los contados". La impresión decidía según si ya
 * estaba cobrado al imprimir; como se imprime la noche anterior al reparto,
 * todo salía CRÉDITO. Y lo declarado a SUNAT usaba otra regla: crédito solo si
 * el cliente tenía días de crédito cargados (ninguno los tenía), así que las
 * ventas a crédito se habrían declarado como contado.
 *
 * Ahora manda cómo se vendió (pedidos.tipo_pago). El plazo es el del cliente
 * (Maestros → Clientes → Días de crédito) y, si no tiene, 7 días.
 */

export const DIAS_CREDITO_POR_DEFECTO = 7

export interface CondicionPago {
  credito: boolean
  /** "CONTADO" o "CRÉDITO", para el papel. */
  etiqueta: 'CONTADO' | 'CRÉDITO'
  dias: number
  /** YYYY-MM-DD, solo a crédito. */
  vencimiento: string | null
}

export function condicionDePago(
  tipoPago: string | null | undefined,
  creditoDiasCliente: number | null | undefined,
  fechaEmision: string,
): CondicionPago {
  if (tipoPago !== 'credito') {
    return { credito: false, etiqueta: 'CONTADO', dias: 0, vencimiento: null }
  }
  const pactados = Number(creditoDiasCliente ?? 0)
  const dias = pactados > 0 ? Math.round(pactados) : DIAS_CREDITO_POR_DEFECTO
  const d = new Date(`${fechaEmision.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return { credito: true, etiqueta: 'CRÉDITO', dias, vencimiento: d.toISOString().slice(0, 10) }
}
