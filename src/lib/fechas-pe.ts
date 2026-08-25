/**
 * Helpers de fecha en zona horaria de Lima (UTC-5).
 *
 * Perú NO usa horario de verano, por lo que el offset es constante: -5h.
 * El bug que se viene arrastrando es que `new Date().toISOString().split('T')[0]`
 * devuelve la fecha en UTC, no en Lima. Entre 19:00 y 23:59 hora local, eso
 * adelanta un día y los registros (compras, cobros, comprobantes, etc.)
 * se guardan con la fecha de mañana.
 */

const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000 // 5 horas en milisegundos

/**
 * Devuelve la fecha de HOY en Lima en formato YYYY-MM-DD.
 * Reemplaza a `new Date().toISOString().split('T')[0]`.
 */
export function hoyLima(): string {
  return new Date(Date.now() - LIMA_OFFSET_MS).toISOString().split('T')[0]
}

/**
 * Devuelve el momento actual en Lima como ISO string (sin Z al final
 * para que se interprete como local). Útil para timestamps que se
 * guardan como `timestamp without time zone`.
 *
 * Para columnas `timestamptz` usa `new Date().toISOString()` directamente,
 * Postgres ya convierte correctamente con UTC.
 */
export function ahoraLimaISO(): string {
  return new Date(Date.now() - LIMA_OFFSET_MS).toISOString().slice(0, -1)
}

/**
 * Convierte una fecha (Date | string) a YYYY-MM-DD interpretada en Lima.
 */
export function fechaLima(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return new Date(date.getTime() - LIMA_OFFSET_MS).toISOString().split('T')[0]
}

/**
 * El principio y el fin de un día de Lima, para filtrar por `created_at`.
 *
 * Hace falta cuando lo que interesa es CUÁNDO se registró algo y no la fecha
 * que el documento lleva impresa. En AGROCAR no son lo mismo: el comprobante
 * hereda la fecha de despacho del pedido, así que lo que se factura hoy para
 * repartir mañana queda fechado mañana. Para saber qué hizo cada persona un
 * día, hay que mirar el momento del registro.
 *
 * Devuelve el rango con el huso de Lima explícito, para que la comparación no
 * dependa de en qué zona horaria esté corriendo el servidor.
 */
export function rangoDiaLima(fecha: string): { desde: string; hasta: string } {
  const siguiente = new Date(fecha + 'T12:00:00-05:00')
  siguiente.setDate(siguiente.getDate() + 1)
  return {
    desde: `${fecha}T00:00:00-05:00`,
    hasta: `${siguiente.toISOString().slice(0, 10)}T00:00:00-05:00`,
  }
}
