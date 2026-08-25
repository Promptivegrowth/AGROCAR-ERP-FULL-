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
 * Papel que se adelanta antes de cortar, en milímetros.
 *
 * La cuchilla está por encima del cabezal, así que sin ese avance el corte cae
 * sobre el texto y se pierde el pie del comprobante. Cuánto exactamente
 * depende del modelo: 15 mm sirve para la ticketera de la oficina y no para
 * la de Daniel, que se comía la última línea. Por eso cada computadora guarda
 * el suyo y este valor es solo el punto de partida.
 */
const CORTE_MM = 15

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
  cortar(avanceMm = CORTE_MM) {
    const puntos = Math.round(Math.max(5, Math.min(40, avanceMm)) / PUNTO_MM)

    /*
     * El avance se manda dentro de la propia orden de corte.
     *
     * Antes iba aparte, con "avanzar n puntos" (ESC J) y después "cortar".
     * Funciona en unas ticketeras y en otras no: la de Daniel ignora esa orden
     * —se le mandaron 20 mm y después 25 y cortó exactamente en el mismo
     * lugar— así que el ajuste no servía de nada donde más hacía falta.
     *
     * `GS V B n` dice "avanzá n puntos y cortá" en un solo comando, y es el
     * que los clones implementan de verdad. Se manda igual el avance suelto
     * para las que solo entienden ese: la que entiende las dos hace una y la
     * otra queda sin efecto, porque el avance total lo reparten entre ambas.
     */
    const enElCorte = Math.min(puntos, 255)
    const suelto = puntos - enElCorte
    if (suelto > 0) this.avanzarPuntos(suelto)
    return this.bytes(GS, 0x56, 0x42, enElCorte)
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
