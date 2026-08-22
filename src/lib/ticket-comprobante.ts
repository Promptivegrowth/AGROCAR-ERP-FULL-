/**
 * El ticket de AGROCAR: una sola maquetación, dos salidas.
 *
 * Antes había dos diseños escritos por separado —el HTML del preview y el
 * ESC/POS de la ticketera— que reproducían los mismos datos con distinta
 * estructura. Con el tiempo se separaron tanto que parecían dos documentos
 * distintos: lo que se veía en pantalla no era lo que salía del papel.
 *
 * Ahora `disenarTicket` describe el comprobante una sola vez, en bloques, y
 * cada salida se limita a dibujar esos bloques: `construirTicket` los pasa a
 * ESC/POS para la ticketera y `VistaTicket` los dibuja en pantalla. Si el
 * diseño cambia, cambia en los dos lados a la vez, porque es el mismo.
 *
 * Las medidas mandan desde el papel y no desde la pantalla: la ticketera
 * imprime en una grilla de 48 caracteres y no sabe poner dos cosas lado a
 * lado. El preview se acomoda a eso, no al revés.
 */

import {
  TicketEscPos, COLUMNAS, COLUMNAS_CHICA, ANCHO_PUNTOS, imagenAPuntos, normalizarCp437,
} from './escpos'

export type LineaTicket = {
  codigo?: string | null
  descripcion: string
  cantidad: number
  precio: number
  total: number
}

export type DatosTicket = {
  empresa: {
    razon_social: string
    ruc: string
    slogan?: string | null
    direccion?: string          // domicilio fiscal
    direccionAnexo?: string | null
    telefono?: string
    correo?: string
  }
  tipoDocumento: string          // "BOLETA DE VENTA ELECTRONICA"
  serieNumero: string            // "B002-00000134"
  fechaEmision: string           // "21/08/2026"
  fechaDespacho?: string | null
  condicion?: string | null      // CONTADO / CREDITO
  editado?: boolean
  cliente: { nombre: string; doc?: string | null; tipoDoc?: string | null; direccion?: string | null; telefono?: string | null }
  lineas: LineaTicket[]
  opGravada: number
  igv: number
  total: number
  totalEnLetras?: string | null
  usuario?: string | null
  vendedor?: string | null
  impreso?: string | null
  qr: string
  /**
   * Tamaño del módulo del QR, en puntos. Lo calcula quien arma los datos, con
   * `moduloQrMinimo`, porque depende del contenido y necesita la librería de
   * QR: dejarlo fijo hace que en algunos comprobantes el código quede por
   * debajo de los 2 cm que exige SUNAT.
   */
  qrModulo?: number
  logoUrl?: string | null
}

// ── Bloques ─────────────────────────────────────────────────────────────────

/**
 * Un renglón de texto ya resuelto: viene con el relleno puesto, así que las
 * dos salidas dibujan exactamente los mismos caracteres en las mismas
 * posiciones. Partir o alinear en cada salida por separado es justamente lo
 * que hizo que se despegaran.
 */
export type BloqueTexto = {
  tipo: 'texto'
  texto: string
  alinear: 'izq' | 'centro'
  negrita: boolean
  alto: 1 | 2
  chica: boolean
}

export type Bloque =
  | BloqueTexto
  | { tipo: 'logo'; url: string; anchoPuntos: number }
  | { tipo: 'qr'; contenido: string; modulo: number }

/**
 * Tamaño de módulo por defecto, para cuando no se calculó uno.
 *
 * Lo normal es que llegue calculado en `qrModulo`, que es lo único que
 * garantiza los 2 cm de lado que exige SUNAT en cualquier comprobante.
 */
export const QR_MODULO = 5

/** Ancho del logo en el ticket, en puntos: la mitad larga del papel. */
const LOGO_PUNTOS = 240

const money = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Cantidad.
 *
 * Con decimales cuando los tiene: hay ventas de 0,42 kg de queso, y
 * redondearlas a "0" en el comprobante deja al cliente con una línea que dice
 * que no se llevó nada.
 */
const cantidad = (n: number) => {
  const v = Number.isFinite(n) ? n : 0
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

/** Parte un texto largo en varios renglones, sin cortar palabras. */
function envolver(texto: string, ancho: number): string[] {
  const palabras = normalizarCp437(texto ?? '').split(/\s+/).filter(Boolean)
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

/** Etiqueta a la izquierda y valor pegado a la derecha, en un solo renglón. */
function filaDoble(izquierda: string, derecha: string, ancho = COLUMNAS): string {
  // Normalizado antes de medir: si un carácter se descarta después, el relleno
  // calculado sobra y el importe deja de quedar pegado al borde derecho.
  const der = normalizarCp437(derecha ?? '')
  const espacio = ancho - der.length
  const izq = normalizarCp437(izquierda ?? '').slice(0, Math.max(0, espacio - 1))
  return izq + ' '.repeat(Math.max(1, espacio - izq.length)) + der
}

// Columnas del detalle, en caracteres. Suman 48.
const COL_CODIGO = 8
const COL_CANT = 5
const COL_PUNIT = 8
const COL_TOTAL = 9
const COL_PRODUCTO = COLUMNAS - COL_CODIGO - COL_CANT - COL_PUNIT - COL_TOTAL

/**
 * Describe el comprobante en bloques. Es pura: no toca ni la impresora ni el
 * navegador, así que las dos salidas parten del mismo resultado.
 */
export function disenarTicket(d: DatosTicket): Bloque[] {
  const b: Bloque[] = []

  const texto = (
    texto: string,
    o: { alinear?: 'izq' | 'centro'; negrita?: boolean; alto?: 1 | 2; chica?: boolean } = {},
  ) => {
    b.push({
      tipo: 'texto',
      // Se normaliza acá, en el diseño, y no en cada salida: así la pantalla
      // y el papel muestran exactamente los mismos caracteres. El ancho de
      // columna también depende de esto, porque una letra que se descarta
      // corre todo lo que viene después.
      texto: normalizarCp437(texto),
      alinear: o.alinear ?? 'izq',
      negrita: o.negrita ?? false,
      alto: o.alto ?? 1,
      chica: o.chica ?? false,
    })
  }
  const chica = (t: string, alinear: 'izq' | 'centro' = 'izq') => texto(t, { alinear, chica: true })
  const separador = () => texto('-'.repeat(COLUMNAS))

  // ── Encabezado
  if (d.logoUrl) b.push({ tipo: 'logo', url: d.logoUrl, anchoPuntos: LOGO_PUNTOS })
  if (d.empresa.slogan) chica(d.empresa.slogan, 'centro')
  texto(`${d.empresa.razon_social} - RUC ${d.empresa.ruc}`, { alinear: 'centro', negrita: true })
  if (d.empresa.direccion) envolver(d.empresa.direccion, COLUMNAS_CHICA).forEach((l) => chica(l, 'centro'))
  if (d.empresa.direccionAnexo) envolver(d.empresa.direccionAnexo, COLUMNAS_CHICA).forEach((l) => chica(l, 'centro'))
  if (d.empresa.telefono || d.empresa.correo) {
    const contacto = [d.empresa.telefono ? `Tel. ${d.empresa.telefono}` : '', d.empresa.correo ?? '']
      .filter(Boolean).join(' - ')
    envolver(contacto, COLUMNAS_CHICA).forEach((l) => chica(l, 'centro'))
  }

  texto(d.tipoDocumento, { alinear: 'centro', negrita: true })
  texto(d.serieNumero, { alinear: 'centro', negrita: true, alto: 2 })
  if (d.editado) chica('** COMPROBANTE EDITADO **', 'centro')

  // ── Datos del comprobante
  texto(filaDoble(`F. Emision: ${d.fechaEmision}`, d.condicion ? `Cond: ${d.condicion}` : ''))
  if (d.fechaDespacho) texto(`F. Despacho: ${d.fechaDespacho}`)
  if (d.cliente.doc) {
    texto(`${d.cliente.tipoDoc ?? 'DOC'}: ${d.cliente.doc}${d.cliente.telefono ? ` - Tel: ${d.cliente.telefono}` : ''}`)
  }
  envolver(`Cliente: ${d.cliente.nombre}`, COLUMNAS).forEach((l) => texto(l))
  if (d.cliente.direccion) envolver(`Direccion: ${d.cliente.direccion}`, COLUMNAS).forEach((l) => texto(l))

  // ── Detalle
  separador()
  texto(
    'CODIGO'.padEnd(COL_CODIGO) +
    'PRODUCTO'.padEnd(COL_PRODUCTO) +
    'CANT.'.padStart(COL_CANT) +
    'P.UNIT.'.padStart(COL_PUNIT) +
    'TOTAL'.padStart(COL_TOTAL),
    { negrita: true },
  )
  separador()

  for (const l of d.lineas) {
    // El nombre completo primero, a todo el ancho: es lo que el cliente
    // revisa, y recortarlo para que entre en una sola línea lo vuelve ilegible.
    const nombre = envolver(l.descripcion, COLUMNAS - COL_CODIGO)
    nombre.forEach((parte, i) => {
      texto((i === 0 ? (l.codigo ?? '').slice(0, COL_CODIGO - 1).padEnd(COL_CODIGO) : ' '.repeat(COL_CODIGO)) + parte)
    })
    // Las cifras debajo, cada una en su columna
    texto(
      ' '.repeat(COL_CODIGO + COL_PRODUCTO) +
      cantidad(l.cantidad).padStart(COL_CANT) +
      money(l.precio).padStart(COL_PUNIT) +
      money(l.total).padStart(COL_TOTAL),
    )
  }

  // ── Totales
  separador()
  texto(filaDoble('OP. GRAVADA:', `S/ ${money(d.opGravada)}`), { negrita: true })
  texto(filaDoble('IGV 18%:', `S/ ${money(d.igv)}`), { negrita: true })
  texto(filaDoble('IMPORTE TOTAL:', `S/ ${money(d.total)}`), { negrita: true, alto: 2 })

  if (d.totalEnLetras) {
    envolver(`SON: ${d.totalEnLetras}`, COLUMNAS_CHICA).forEach((l) => chica(l))
  }

  /**
   * QR exigido por SUNAT.
   *
   * Va solo en su renglón y no al costado de los totales como estaba el
   * preview: la ticketera imprime renglón por renglón y no sabe poner texto
   * al lado de una imagen. Manda el papel, que es lo que el cliente se lleva.
   */
  chica('')
  b.push({ tipo: 'qr', contenido: d.qr, modulo: d.qrModulo ?? QR_MODULO })
  chica('')

  // ── Pie
  if (d.usuario) chica(`Usuario: ${d.usuario}`)
  if (d.vendedor) envolver(`VDR: ${d.vendedor}`, COLUMNAS_CHICA).forEach((l) => chica(l))
  chica(`Impreso: ${d.impreso ?? ''}`)

  texto('** GRACIAS POR SU COMPRA **', { alinear: 'centro', negrita: true })
  chica('Representacion impresa - Consulta www.sunat.gob.pe', 'centro')

  return b
}

/**
 * Pasa los bloques a ESC/POS, que es lo que entiende la ticketera.
 *
 * `incluirLogo` requiere navegador (usa canvas para pasar el PNG a puntos).
 * Si falla la carga del logo, el ticket sale igual con el nombre en texto: es
 * preferible un comprobante sin logo que uno que no se imprime.
 */
export async function construirTicket(d: DatosTicket, incluirLogo = true): Promise<TicketEscPos> {
  const t = new TicketEscPos()

  for (const bloque of disenarTicket(d)) {
    if (bloque.tipo === 'logo') {
      if (!incluirLogo || typeof window === 'undefined') continue
      try {
        const puntos = await imagenAPuntos(bloque.url, Math.min(bloque.anchoPuntos, ANCHO_PUNTOS))
        if (puntos.length) {
          t.alinear('centro')
          t.imagen(puntos)
        }
      } catch {
        /* sin logo, el ticket sigue */
      }
      continue
    }

    if (bloque.tipo === 'qr') {
      t.alinear('centro')
      t.qr(bloque.contenido, bloque.modulo)
      continue
    }

    t.alinear(bloque.alinear === 'centro' ? 'centro' : 'izq')
    t.estilo({ negrita: bloque.negrita, alto: bloque.alto, chica: bloque.chica })
    t.linea(bloque.texto)
  }

  t.normal()
  t.cortar()
  return t
}
