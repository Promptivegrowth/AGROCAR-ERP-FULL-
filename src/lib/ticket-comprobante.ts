/**
 * El ticket de AGROCAR armado en ESC/POS.
 *
 * Reproduce el mismo comprobante que hoy se imprime por el navegador —los
 * datos que exige SUNAT en la representación impresa— pero en el idioma de la
 * ticketera, para que el corte lo decida el ticket y no el driver.
 *
 * El QR lo genera la propia impresora: sale nítido y ocupa unos 60 bytes,
 * contra varios miles si se mandara como imagen.
 */

import { TicketEscPos, COLUMNAS, imagenAPuntos } from './escpos'

export type LineaTicket = {
  codigo?: string | null
  descripcion: string
  cantidad: number
  precio: number
  total: number
}

export type DatosTicket = {
  empresa: { razon_social: string; ruc: string; direccion?: string; telefono?: string; correo?: string }
  tipoDocumento: string          // "BOLETA DE VENTA ELECTRONICA"
  serieNumero: string            // "B002-00000134"
  fechaEmision: string           // "21/08/2026"
  fechaDespacho?: string | null
  condicion?: string | null      // CONTADO / CREDITO
  cliente: { nombre: string; doc?: string | null; tipoDoc?: string | null; direccion?: string | null; telefono?: string | null }
  lineas: LineaTicket[]
  opGravada: number
  igv: number
  total: number
  totalEnLetras?: string | null
  usuario?: string | null
  vendedor?: string | null
  qr: string
  logoUrl?: string | null
}

const money = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const cant = (n: number) => {
  const v = Number.isFinite(n) ? n : 0
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

/**
 * Parte una descripción larga en varias líneas.
 *
 * Los nombres de producto de AGROCAR llegan a 50 caracteres y el papel de
 * 80 mm da 48: sin esto la impresora corta la palabra donde le toca.
 */
function envolver(texto: string, ancho: number): string[] {
  const palabras = (texto ?? '').split(/\s+/).filter(Boolean)
  const lineas: string[] = []
  let actual = ''
  for (const p of palabras) {
    if (actual.length === 0) actual = p
    else if ((actual + ' ' + p).length <= ancho) actual += ' ' + p
    else { lineas.push(actual); actual = p }
  }
  if (actual) lineas.push(actual)
  return lineas.length ? lineas : ['']
}

/**
 * Arma el ticket completo.
 *
 * `incluirLogo` requiere navegador (usa canvas para pasar el PNG a puntos).
 * Si falla la carga del logo, el ticket sale igual con el nombre en texto: es
 * preferible un comprobante sin logo que uno que no se imprime.
 */
export async function construirTicket(d: DatosTicket, incluirLogo = true): Promise<TicketEscPos> {
  const t = new TicketEscPos()

  // ── Encabezado
  t.alinear('centro')

  if (incluirLogo && d.logoUrl && typeof window !== 'undefined') {
    try {
      // 384 puntos es el ancho útil de una térmica de 80 mm; el logo va a la
      // mitad para que no domine el ticket.
      const puntos = await imagenAPuntos(d.logoUrl, 192)
      if (puntos.length) t.imagen(puntos).linea()
    } catch {
      /* sin logo, el ticket sigue */
    }
  }

  t.estilo({ negrita: true, alto: 1, ancho: 1 })
  t.linea(d.empresa.razon_social)
  t.normal()
  t.linea(`RUC ${d.empresa.ruc}`)
  if (d.empresa.direccion) envolver(d.empresa.direccion, COLUMNAS).forEach((l) => t.linea(l))
  if (d.empresa.telefono) t.linea(`Tel. ${d.empresa.telefono}`)
  if (d.empresa.correo) t.linea(d.empresa.correo)

  t.linea()
  t.estilo({ negrita: true })
  t.linea(d.tipoDocumento)
  t.estilo({ negrita: true, alto: 2, ancho: 1 })
  t.linea(d.serieNumero)
  t.normal()

  // ── Datos del comprobante
  t.alinear('izq')
  t.separador()
  t.filaDoble(`F. Emision: ${d.fechaEmision}`, d.condicion ? `Cond: ${d.condicion}` : '')
  if (d.fechaDespacho) t.linea(`F. Despacho: ${d.fechaDespacho}`)
  if (d.cliente.doc) t.linea(`${d.cliente.tipoDoc ?? 'DOC'}: ${d.cliente.doc}${d.cliente.telefono ? ` - Tel: ${d.cliente.telefono}` : ''}`)
  envolver(`Cliente: ${d.cliente.nombre}`, COLUMNAS).forEach((l) => t.linea(l))
  if (d.cliente.direccion) envolver(`Direccion: ${d.cliente.direccion}`, COLUMNAS).forEach((l) => t.linea(l))

  // ── Detalle
  t.separador()
  t.linea('CANT  DESCRIPCION'.padEnd(COLUMNAS - 18) + 'P.UNIT     TOTAL')
  t.separador()

  for (const l of d.lineas) {
    // El nombre completo primero, en sus propias líneas: es lo que el cliente
    // revisa, y recortarlo para que entre en una sola lo vuelve ilegible.
    const nombre = l.codigo ? `${l.codigo} ${l.descripcion}` : l.descripcion
    envolver(nombre, COLUMNAS).forEach((linea) => t.linea(linea))
    t.filaDoble(`  ${cant(l.cantidad)} x ${money(l.precio)}`, money(l.total))
  }

  // ── Totales
  t.separador()
  t.filaDoble('OP. GRAVADA:', `S/ ${money(d.opGravada)}`)
  t.filaDoble('IGV 18%:', `S/ ${money(d.igv)}`)
  t.estilo({ negrita: true, alto: 2, ancho: 1 })
  t.filaDoble('TOTAL:', `S/ ${money(d.total)}`)
  t.normal()

  if (d.totalEnLetras) {
    t.linea()
    envolver(`SON: ${d.totalEnLetras}`, COLUMNAS).forEach((l) => t.linea(l))
  }

  /**
   * QR exigido por SUNAT.
   *
   * El modulo va en 5 puntos y no en 6: SUNAT pide que el QR mida al menos
   * 2 cm de lado en la representacion impresa, y con 5 el codigo mas chico que
   * puede salir con estos datos queda en 2,1 cm. Bajar a 4 lo dejaria por
   * debajo del minimo en algunos comprobantes.
   */
  t.linea()
  t.alinear('centro')
  t.qr(d.qr, 5)

  // ── Pie
  t.alinear('izq')
  if (d.usuario) t.linea(`Usuario: ${d.usuario}`)
  if (d.vendedor) envolver(`VDR: ${d.vendedor}`, COLUMNAS).forEach((l) => t.linea(l))
  t.linea(`Impreso: ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })}`)

  t.alinear('centro')
  t.estilo({ negrita: true })
  t.linea('** GRACIAS POR SU COMPRA **')
  t.normal()
  t.linea('Representacion impresa - www.sunat.gob.pe')

  t.cortar()
  return t
}
