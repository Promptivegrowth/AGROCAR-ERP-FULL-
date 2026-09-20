/**
 * Traer todas las filas de una consulta, no las primeras mil.
 *
 * Supabase corta cualquier consulta en **mil filas** y no avisa: la consulta
 * simplemente devuelve menos. Poner `.limit(5000)` no sirve —el tope lo impone
 * el servidor y gana—, así que la única salida es pedir de a páginas.
 *
 * Ya mordió tres veces en este sistema:
 *
 *   - Facturación traía todos los comprobantes y los más viejos desaparecían
 *     de la pantalla al pasar de mil.
 *   - La caja cruzaba los 1.065 movimientos con cobro para saber cuáles
 *     estaban liquidados; los 65 que no entraban aparecían como pendientes, y
 *     Daniel veía "hay 21 cobros sin liquidar del 17" sobre cobros ya
 *     cerrados.
 *   - Cuentas por cobrar suma comprobantes y cobros por cliente: con las dos
 *     listas cortadas, los saldos salían mal.
 *
 * Lo mejor sigue siendo no traer la tabla: filtrar por fecha, o hacer la suma
 * en la base con una función. Esto es para cuando de verdad hacen falta todas
 * las filas.
 *
 *     const cobros = await traerTodo(
 *       (desde, hasta) => supabase.from('cobros').select('cliente_id, total').range(desde, hasta),
 *     )
 */

/** Lo que Supabase devuelve como mucho de una vez. */
export const TOPE_POR_PAGINA = 1000

/** Por si una consulta mal filtrada intentara traerse media base. */
const TOPE_DE_SEGURIDAD = 100_000

export async function traerTodo<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const todo: T[] = []

  for (let desde = 0; desde < TOPE_DE_SEGURIDAD; desde += TOPE_POR_PAGINA) {
    const { data, error } = await pagina(desde, desde + TOPE_POR_PAGINA - 1)
    if (error) throw error

    const filas = data ?? []
    todo.push(...filas)

    // Una página incompleta significa que no hay más.
    if (filas.length < TOPE_POR_PAGINA) return todo
  }

  return todo
}
