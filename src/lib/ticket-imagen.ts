/**
 * El ticket que se ve en pantalla, mandado tal cual a la ticketera.
 *
 * El comprobante tiene elementos que la impresora no sabe escribir por su
 * cuenta —el logo, el eslogan en su tipografía, el QR al costado de los
 * totales—, así que en vez de volver a describirlo en el idioma de la
 * ticketera se dibuja el mismo pedazo de pantalla y se manda como imagen. No
 * hay dos diseños que puedan separarse: hay uno, y del papel sale una foto.
 *
 * Lo que antes fallaba con el navegador no era la imagen sino quién decidía el
 * corte: el driver agregaba su propio margen final y no había forma de decirle
 * dónde cortar. Acá la imagen la manda el sistema y el corte lo ordena el
 * ticket, así que no sobra papel.
 */

import html2canvas from 'html2canvas'
import { TicketEscPos, ANCHO_PUNTOS } from './escpos'

/**
 * Punto de corte entre blanco y negro.
 *
 * La térmica no tiene grises: cada punto se imprime o no. El texto del ticket
 * es negro sobre blanco, así que un umbral alto conserva los bordes suavizados
 * de las letras en vez de comérselos y dejarlas flacas.
 */
const UMBRAL = 186

/** Pasa un lienzo a puntos en blanco y negro, del ancho exacto del cabezal. */
function aPuntos(lienzo: HTMLCanvasElement): boolean[][] {
  const ctx = lienzo.getContext('2d')
  if (!ctx) return []
  const { width, height } = lienzo
  const datos = ctx.getImageData(0, 0, width, height).data

  const puntos: boolean[][] = []
  for (let y = 0; y < height; y++) {
    const fila: boolean[] = new Array(ANCHO_PUNTOS).fill(false)
    // Si el dibujo salió un pixel más angosto o más ancho por redondeo, se
    // recorta o se rellena con blanco: el cabezal siempre mide lo mismo.
    const hasta = Math.min(width, ANCHO_PUNTOS)
    for (let x = 0; x < hasta; x++) {
      const i = (y * width + x) * 4
      const alfa = datos[i + 3]
      if (alfa < 128) continue // transparente = papel
      const luz = 0.299 * datos[i] + 0.587 * datos[i + 1] + 0.114 * datos[i + 2]
      fila[x] = luz < UMBRAL
    }
    puntos.push(fila)
  }
  return puntos
}

/** Recorta las filas totalmente blancas del final: son papel regalado. */
function sinBlancoFinal(puntos: boolean[][]): boolean[][] {
  let fin = puntos.length
  while (fin > 0 && !puntos[fin - 1].some(Boolean)) fin--
  return puntos.slice(0, fin)
}

/**
 * Dibuja un nodo del ticket y lo devuelve listo para la ticketera.
 *
 * Espera a que las tipografías estén cargadas: sin eso el eslogan sale con la
 * letra de reemplazo, que es justamente la que Daniel no pidió.
 */
export async function ticketDesdeNodo(nodo: HTMLElement, avanceCorteMm?: number): Promise<TicketEscPos> {
  try {
    await document.fonts.ready
  } catch {
    /* si el navegador no lo soporta, se dibuja igual */
  }

  const anchoCss = nodo.getBoundingClientRect().width
  if (!anchoCss) throw new Error('El ticket no está visible en pantalla')

  const lienzo = await html2canvas(nodo, {
    scale: ANCHO_PUNTOS / anchoCss,
    backgroundColor: '#ffffff',
    logging: false,
    useCORS: true,
    onclone: (doc) => {
      // La sombra y los bordes redondeados son de la pantalla, no del papel
      doc.querySelectorAll<HTMLElement>('.ticket-imprimible').forEach((n) => {
        n.style.boxShadow = 'none'
        n.style.borderRadius = '0'
        n.style.margin = '0'
      })
    },
  })

  const puntos = sinBlancoFinal(aPuntos(lienzo))
  if (!puntos.length) throw new Error('El ticket salió en blanco')

  const t = new TicketEscPos()
  t.alinear('izq')
  t.imagen(puntos)
  t.cortar(avanceCorteMm)
  return t
}
