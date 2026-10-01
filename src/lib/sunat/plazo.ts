/**
 * Cuándo se declara cada comprobante: aprovechando el plazo, sin pasarse.
 *
 * Daniel quiere el tiempo que da SUNAT para corregir: anular o editar desde el
 * sistema si hubo un error o una devolución, mientras el comprobante todavía
 * no salió. Una vez declarado ya no se toca —solo se corrige con nota de
 * crédito—, así que cada día de espera es un día de margen.
 *
 * El plazo (RS 000003-2023/SUNAT): la factura se envía hasta el TERCER día
 * calendario siguiente a su emisión. Emitida el 01/10, vence el 04/10. Lo que
 * llega después deja de ser comprobante electrónico y no sustenta crédito
 * fiscal. Para la boleta la orientación de SUNAT da más (resumen diario hasta
 * el séptimo día), pero el sistema la manda de a una, como la factura, y las
 * fuentes no coinciden sobre ese caso: se usa el mismo plazo de tres días, que
 * es el más estricto.
 *
 * Se espera DOS días, no tres: el último día queda de reserva. Si el envío del
 * día elegido falla —SUNAT caído, sin conexión—, al día siguiente se reintenta
 * y todavía está dentro del plazo. Esperar los tres no deja revancha.
 */

/** Días calendario que da SUNAT después de la emisión. */
export const PLAZO_SUNAT_DIAS = 3

/** Lo más que se puede esperar sin quedarse sin día de reintento. */
export const DIAS_ESPERA_MAX = PLAZO_SUNAT_DIAS - 1

export const DIAS_ESPERA_POR_OMISION = DIAS_ESPERA_MAX

/** Lo que venga de la configuración, llevado a un valor seguro. */
export function normalizarDiasEspera(valor: unknown): number {
  const n = Math.floor(Number(valor))
  if (!Number.isFinite(n) || String(valor ?? '').trim() === '') return DIAS_ESPERA_POR_OMISION
  return Math.min(Math.max(n, 0), DIAS_ESPERA_MAX)
}

/** 'YYYY-MM-DD' + n días, sin pasar por la hora local. */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** El día en que el envío automático lo declara. */
export function diaDeEnvio(fechaEmision: string, diasEspera: number): string {
  return sumarDias(fechaEmision, diasEspera)
}

/** El último día en que SUNAT lo recibe. */
export function venceElPlazo(fechaEmision: string): string {
  return sumarDias(fechaEmision, PLAZO_SUNAT_DIAS)
}
