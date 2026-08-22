/**
 * Lo que se le manda a la ticketera, en su propio idioma.
 *
 * El navegador solo sabe imprimir por el driver de Windows, que decide el
 * corte según el tamaño de papel configurado y agrega su propio margen final.
 * De ahí venía el papel desperdiciado: no hay forma de decirle "cortá acá".
 *
 * Acá el ticket viaja como comandos ESC/POS —el idioma nativo de la
 * impresora—, el agente local se los pasa en modo RAW y el corte lo ordena el
 * comando GS V, no el driver.
 *
 * El comprobante se manda como imagen y no como texto: lleva el logo, el
 * eslogan con su tipografía y el QR al costado de los totales, cosas que la
 * impresora no sabe componer por su cuenta. Quien la arma es `ticket-imagen`,
 * dibujando la misma pantalla que ve el usuario.
 *
 * Referencia de comandos: ESC/POS de Epson, que las POS-80 replican.
 */

// ── Comandos ────────────────────────────────────────────────────────────────
const ESC = 0x1b
const GS = 0x1d

/**
 * Ancho útil del cabezal, en puntos.
 *
 * Una térmica de 80 mm imprime sobre 72 mm a 203 puntos por pulgada: 576
 * puntos. De acá salen todas las medidas del ticket.
 */
export const ANCHO_PUNTOS = 576

/** Un punto de la impresora, en milímetros. */
export const PUNTO_MM = 25.4 / 203

/**
 * Papel que se adelanta antes de cortar, en puntos.
 *
 * La cuchilla está unos 15 mm por encima del cabezal; a 203 puntos por pulgada
 * eso son 120 puntos. Es una medida de la impresora, no del diseño del ticket:
 * sin ese avance el corte cae sobre el texto y se pierde el pie.
 */
const CORTE_PUNTOS = 120

/** Filas por bloque al mandar una imagen. */
const BANDA_MAXIMA = 255

export class TicketEscPos {
  private partes: number[] = []

  /** Inicializa la impresora y limpia cualquier estado anterior. */
  constructor() {
    this.bytes(ESC, 0x40)
  }

  bytes(...b: number[]) {
    this.partes.push(...b)
    return this
  }

  /** Alineación: izquierda, centro o derecha. */
  alinear(donde: 'izq' | 'centro' | 'der') {
    const n = donde === 'centro' ? 1 : donde === 'der' ? 2 : 0
    return this.bytes(ESC, 0x61, n)
  }

  /** Avanza una distancia exacta de papel, en puntos (ESC J n). */
  avanzarPuntos(puntos: number) {
    return this.bytes(ESC, 0x4a, Math.max(0, Math.min(255, Math.round(puntos))))
  }

  /**
   * Corta el papel.
   *
   * El avance previo va en puntos y no en renglones a propósito: la distancia
   * a la cuchilla es física y no cambia, mientras que un renglón mide lo que
   * diga el interlineado.
   */
  cortar() {
    this.avanzarPuntos(CORTE_PUNTOS)
    return this.bytes(GS, 0x56, 0x42, 0x00)
  }

  /**
   * Imagen en blanco y negro (GS v 0).
   *
   * `puntos` es una matriz de filas: cada valor true es un punto negro. Se
   * manda de a bloques porque algunas ticketeras se atragantan con una imagen
   * entera de mil filas y no imprimen nada, sin avisar.
   */
  imagen(puntos: boolean[][]) {
    for (let inicio = 0; inicio < puntos.length; inicio += BANDA_MAXIMA) {
      this.banda(puntos.slice(inicio, inicio + BANDA_MAXIMA))
    }
    return this
  }

  private banda(puntos: boolean[][]) {
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
