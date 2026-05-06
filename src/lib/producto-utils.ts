/**
 * Devuelve el nombre comercial visible del producto.
 * Prioriza `descripcion` (nombre comercial específico) y cae a `nombre` (grupo/categoría).
 *
 * Caso de uso: el cliente migró sus productos desde Excel donde "nombre" tenía
 * la categoría genérica (CHORIZOS, AHUMADOS) y el detalle real estaba en
 * "descripcion" (CHORIZO PARRILLERO X 500GR.CERDEÑA). En todos los flujos
 * visuales preferimos mostrar la descripción.
 */
export function productoLabel(producto: {
  descripcion?: string | null
  nombre?: string | null
} | null | undefined): string {
  if (!producto) return '—'
  const d = producto.descripcion?.trim()
  if (d) return d
  return producto.nombre?.trim() || '—'
}

/** Etiqueta secundaria: grupo/categoría + código. */
export function productoSubLabel(producto: {
  nombre?: string | null
  codigo?: string | null
  descripcion?: string | null
} | null | undefined): string {
  if (!producto) return ''
  const partes: string[] = []
  // Solo mostrar el "nombre" (grupo) si NO es lo mismo que la descripción
  const d = producto.descripcion?.trim()
  if (producto.nombre && producto.nombre.trim() && producto.nombre.trim() !== d) {
    partes.push(producto.nombre.trim())
  }
  if (producto.codigo) partes.push(producto.codigo)
  return partes.join(' · ')
}
