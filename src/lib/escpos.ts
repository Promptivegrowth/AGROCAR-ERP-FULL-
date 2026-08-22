/**
 * Generación de tickets en ESC/POS.
 *
 * El navegador solo sabe imprimir por el driver de Windows, que convierte la
 * página a imagen —673 KB por ticket— y decide el corte según el tamaño de
 * papel configurado, agregando su propio margen final. De ahí venía el papel
 * desperdiciado: no hay forma de decirle "cortá acá".
 *
 * Acá el ticket se arma como comandos ESC/POS, que es el idioma nativo de la
 * ticketera. El agente local los pasa a la impresora en modo RAW y el corte lo
 * decide el comando GS V, no el driver. Un ticket completo pesa unos 400 bytes.
 *
 * Referencia de comandos: ESC/POS de Epson, que las POS-80 replican.
 */

/**
 * Los caracteres del español que CP437 sí tiene, con su código.
 *
 * Sin esto habría que escribir los comprobantes sin acentos, y el nombre de un
 * cliente o de un producto saldría distinto de como está en el sistema.
 */
const CP437: Record<string, number> = {
  'á': 160, 'é': 130, 'í': 161, 'ó': 162, 'ú': 163, 'É': 144,
  'ñ': 164, 'Ñ': 165, 'ü': 129, 'Ü': 154,
  '¿': 168, '¡': 173, 'º': 167, 'ª': 166, '°': 248, '·': 250,
}

/**
 * El texto tal como va a salir impreso.
 *
 * Las vocales acentuadas en mayúscula no están en la tabla y salen sin acento.
 * Esta función deja el texto igual a como quedará en el papel, y la vista en
 * pantalla la usa también: así lo que se lee en la pantalla es carácter por
 * carácter lo que se lee en el ticket, sin sorpresas al imprimir.
 */
export function normalizarCp437(t: string): string {
  let salida = ''
  for (const c of (t ?? '')) {
    if (CP437[c] !== undefined) { salida += c; continue }
    const codigo = c.charCodeAt(0)
    if (codigo >= 0x20 && codigo <= 0x7e) { salida += c; continue }
    const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '')
    const b = base.charCodeAt(0)
    if (base.length === 1 && b >= 0x20 && b <= 0x7e) salida += base
  }
  return salida
}

// ── Comandos ────────────────────────────────────────────────────────────────
const ESC = 0x1b
const GS = 0x1d

/**
 * Ancho útil del cabezal, en puntos.
 *
 * Una térmica de 80 mm imprime sobre 72 mm a 203 puntos por pulgada: 576
 * puntos. De acá salen las medidas de todo lo que no es texto —el logo, el
 * QR— y la equivalencia con milímetros de la vista en pantalla.
 */
export const ANCHO_PUNTOS = 576

/** Un punto de la impresora, en milímetros. */
export const PUNTO_MM = 25.4 / 203

/** Ancho del papel de 80 mm en caracteres, con la fuente normal. */
export const COLUMNAS = 48

/** Lo mismo con la fuente chica, que entra más veces en el mismo ancho. */
export const COLUMNAS_CHICA = 64

/**
 * Alto de cada renglon, en puntos.
 *
 * La impresora arranca en 30 y la letra mide 24: sobran 6 puntos de aire en
 * cada renglon, que en un ticket de 40 renglones son casi 2 cm de papel
 * regalados. Con 26 quedan 2 puntos de separacion —se lee igual de bien— y el
 * ticket sale tan compacto como se ve en pantalla.
 */
const INTERLINEADO = 26

/** Lo mismo para la fuente chica, cuya letra mide 17 puntos. */
const INTERLINEADO_CHICO = 19

/**
 * Papel que se adelanta antes de cortar, en puntos.
 *
 * La cuchilla está unos 15 mm por encima del cabezal; a 203 dpi eso son 120
 * puntos. Es una medida de la impresora, no del diseño del ticket.
 */
const CORTE_PUNTOS = 120

export class TicketEscPos {
  private partes: number[] = []

  /** Inicializa la impresora y limpia cualquier estado anterior. */
  constructor() {
    this.bytes(ESC, 0x40)
    this.interlineado(INTERLINEADO)
  }

  /** Alto del renglon, en puntos (ESC 3 n). */
  interlineado(puntos: number) {
    return this.bytes(ESC, 0x33, Math.max(0, Math.min(255, Math.round(puntos))))
  }

  bytes(...b: number[]) {
    this.partes.push(...b)
    return this
  }

  /**
   * Texto, en CP437: la tabla que estas impresoras traen de fábrica.
   *
   * CP437 tiene la ñ y las vocales acentuadas, así que se traducen a su código
   * en vez de quitarles el acento —"CERDEÑA" salía "CERDENA", y en pantalla se
   * veía bien, con lo cual la vista previa mentía—. Lo que no está en la tabla
   * se reemplaza por su letra sin acento, y si tampoco eso existe se descarta:
   * un carácter perdido es mejor que un comprobante lleno de basura.
   */
  texto(t: string) {
    for (const c of normalizarCp437(t)) {
      this.partes.push(CP437[c] ?? (c.charCodeAt(0) & 0xff))
    }
    return this
  }

  linea(t = '') {
    return this.texto(t).bytes(0x0a)
  }

  /** Alineación: izquierda, centro o derecha. */
  alinear(donde: 'izq' | 'centro' | 'der') {
    const n = donde === 'centro' ? 1 : donde === 'der' ? 2 : 0
    return this.bytes(ESC, 0x61, n)
  }

  /**
   * Tamaño y grosor. `alto` y `ancho` multiplican el cuerpo (1 = normal, 2 =
   * doble). Se usan juntos porque el comando es uno solo.
   */
  estilo({ negrita = false, alto = 1, ancho = 1, chica = false }: { negrita?: boolean; alto?: number; ancho?: number; chica?: boolean } = {}) {
    // Fuente A (normal) o B (chica): la B entra 64 veces en el ancho del papel
    this.bytes(ESC, 0x4d, chica ? 1 : 0)
    const escala = ((Math.min(ancho, 4) - 1) << 4) | (Math.min(alto, 4) - 1)
    this.bytes(GS, 0x21, escala)
    this.bytes(ESC, 0x45, negrita ? 1 : 0)
    /**
     * El renglon acompana al tamano de la letra.
     *
     * La impresora avanza lo que diga el interlineado y nada mas: si se deja
     * el renglon corto, una linea de letra doble se monta sobre la siguiente.
     * Por eso se ajusta acá y no a mano en cada bloque grande.
     */
    const base = chica ? INTERLINEADO_CHICO : INTERLINEADO
    this.interlineado(base * Math.min(Math.max(alto, 1), 4))
    return this
  }

  /** Vuelve a texto normal: conviene llamarlo después de cada bloque grande. */
  normal() {
    return this.estilo({ negrita: false, alto: 1, ancho: 1, chica: false })
  }

  separador(caracter = '-') {
    return this.linea(caracter.repeat(COLUMNAS))
  }

  /**
   * Dos columnas: etiqueta a la izquierda, valor pegado a la derecha.
   * Si no entran en el ancho, la etiqueta se recorta antes que el valor:
   * el importe nunca se pierde.
   */
  filaDoble(izquierda: string, derecha: string) {
    const der = derecha ?? ''
    const espacio = COLUMNAS - der.length
    const izq = (izquierda ?? '').slice(0, Math.max(0, espacio - 1))
    return this.linea(izq + ' '.repeat(Math.max(1, espacio - izq.length)) + der)
  }

  /** Avanza n líneas de papel. */
  avanzar(lineas = 1) {
    return this.bytes(ESC, 0x64, Math.max(0, Math.min(255, lineas)))
  }

  /** Avanza una distancia exacta de papel, en puntos (ESC J n). */
  avanzarPuntos(puntos: number) {
    return this.bytes(ESC, 0x4a, Math.max(0, Math.min(255, Math.round(puntos))))
  }

  /**
   * Corta el papel.
   *
   * Se avanza primero para sacar el contenido de la zona de la cuchilla, que
   * está unos 15 mm por encima del cabezal. Sin ese avance el corte cae sobre
   * el texto: se probó y se perdía el pie del ticket.
   *
   * El avance va en puntos y no en renglones a propósito: la distancia a la
   * cuchilla es física y no cambia, mientras que un renglón mide lo que diga
   * el interlineado. Cuando se compactó el ticket, contar renglones dejó el
   * corte 2 mm más arriba y se comía la última línea.
   */
  cortar() {
    this.avanzarPuntos(CORTE_PUNTOS)
    return this.bytes(GS, 0x56, 0x42, 0x00)
  }

  /**
   * QR generado por la propia impresora.
   *
   * Sale nítido y ocupa unos 60 bytes, contra varios miles si se manda como
   * imagen. `tamano` es el lado de cada módulo, de 1 a 16.
   */
  qr(contenido: string, tamano = 6) {
    const datos = Array.from(contenido, (c) => c.charCodeAt(0) & 0xff)
    // Modelo 2
    this.bytes(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00)
    // Tamaño del módulo
    this.bytes(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, Math.max(1, Math.min(16, tamano)))
    // Corrección de errores M: aguanta el roce del papel térmico sin perder lectura
    this.bytes(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31)
    // Guardar los datos en el búfer
    const largo = datos.length + 3
    this.bytes(GS, 0x28, 0x6b, largo & 0xff, (largo >> 8) & 0xff, 0x31, 0x50, 0x30, ...datos)
    // Imprimir lo guardado
    this.bytes(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30)
    return this
  }

  /**
   * Imagen en blanco y negro, como mapa de bits (GS v 0).
   *
   * `puntos` es una matriz de filas: cada valor true es un punto negro. El
   * ancho debe ser múltiplo de 8; si no lo es, se rellena con blanco.
   */
  imagen(puntos: boolean[][]) {
    const alto = puntos.length
    if (alto === 0) return this
    const anchoPx = puntos[0].length
    const anchoBytes = Math.ceil(anchoPx / 8)

    this.bytes(GS, 0x76, 0x30, 0x00,
      anchoBytes & 0xff, (anchoBytes >> 8) & 0xff,
      alto & 0xff, (alto >> 8) & 0xff)

    for (let y = 0; y < alto; y++) {
      for (let bx = 0; bx < anchoBytes; bx++) {
        let byte = 0
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit
          if (x < anchoPx && puntos[y][x]) byte |= 0x80 >> bit
        }
        this.partes.push(byte)
      }
    }
    return this
  }

  /** Los bytes listos para mandar al agente. */
  aBytes(): Uint8Array {
    return new Uint8Array(this.partes)
  }

  /** En base64, que es como viaja al agente. */
  aBase64(): string {
    const b = this.aBytes()
    let s = ''
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
    return typeof btoa === 'function' ? btoa(s) : Buffer.from(b).toString('base64')
  }
}

/**
 * Convierte una imagen a puntos en blanco y negro para `imagen()`.
 *
 * La ticketera no tiene grises: cada punto se imprime o no. Se decide por
 * luminosidad con un umbral, en vez de dejar que el driver invente un tramado,
 * que en térmica sale sucio.
 *
 * Solo corre en el navegador; necesita canvas.
 */
export async function imagenAPuntos(
  url: string,
  anchoDestino = 384,
  umbral = 160,
): Promise<boolean[][]> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('No se pudo cargar ' + url))
    img.src = url
  })

  const escala = anchoDestino / img.width
  const ancho = anchoDestino
  const alto = Math.max(1, Math.round(img.height * escala))

  const lienzo = document.createElement('canvas')
  lienzo.width = ancho
  lienzo.height = alto
  const ctx = lienzo.getContext('2d')
  if (!ctx) return []
  // Fondo blanco: los PNG con transparencia salen negros si no se rellena
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, ancho, alto)
  ctx.drawImage(img, 0, 0, ancho, alto)

  const datos = ctx.getImageData(0, 0, ancho, alto).data
  const puntos: boolean[][] = []
  for (let y = 0; y < alto; y++) {
    const fila: boolean[] = []
    for (let x = 0; x < ancho; x++) {
      const i = (y * ancho + x) * 4
      const luz = 0.299 * datos[i] + 0.587 * datos[i + 1] + 0.114 * datos[i + 2]
      fila.push(luz < umbral)
    }
    puntos.push(fila)
  }
  return puntos
}
