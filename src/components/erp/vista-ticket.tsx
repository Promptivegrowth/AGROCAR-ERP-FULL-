import { disenarTicket, type DatosTicket } from '@/lib/ticket-comprobante'
import { COLUMNAS, ANCHO_PUNTOS, PUNTO_MM } from '@/lib/escpos'
import { qrDataUri, modulosQr } from '@/lib/qr'

/**
 * El ticket en pantalla, dibujado desde la misma maquetación que se imprime.
 *
 * No es una versión "parecida" del comprobante: son los mismos bloques que
 * recibe la ticketera, dibujados con las medidas reales del papel. Cada
 * carácter ocupa los mismos 12 puntos que ocupa en el cabezal, el logo y el
 * QR miden los milímetros que van a medir impresos, y los renglones avanzan
 * lo mismo. Lo que se ve es, literalmente, lo que sale.
 *
 * De paso, esta vista es la que se imprime por el navegador en las
 * computadoras sin agente instalado: ese camino también queda igual al otro.
 */

/** Milímetros que ocupan n puntos de la impresora. */
const mm = (puntos: number) => `${(puntos * PUNTO_MM).toFixed(3)}mm`

// La letra normal avanza 12 puntos por carácter y la chica 9. En una fuente
// monoespaciada el avance es 0,6 del cuerpo, así que el cuerpo sale de ahí.
const CUERPO_NORMAL = 12 / 0.6
const CUERPO_CHICO = 9 / 0.6
const RENGLON_NORMAL = 26
const RENGLON_CHICO = 19

/**
 * Monoespaciada de verdad y presente en Windows: la grilla de 48 columnas
 * solo cuadra si todos los caracteres miden igual. Con una tipografía
 * proporcional los importes dejan de alinearse con su columna.
 */
const TIPOGRAFIA = '"Courier New", Courier, ui-monospace, monospace'

export default async function VistaTicket({ datos }: { datos: DatosTicket }) {
  const bloques = disenarTicket(datos)

  // El QR se genera acá porque dentro del dibujo no se puede esperar promesas
  const bloqueQr = bloques.find((b) => b.tipo === 'qr')
  const qrUrl = bloqueQr && bloqueQr.tipo === 'qr' ? await qrDataUri(bloqueQr.contenido, 480) : ''

  return (
    <div
      className="ticket"
      style={{
        width: mm(ANCHO_PUNTOS),
        margin: '0 auto',
        color: '#000',
        background: '#fff',
        fontFamily: TIPOGRAFIA,
        fontVariantLigatures: 'none',
      }}
    >
      {bloques.map((b, i) => {
        if (b.tipo === 'logo') {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={b.url}
              alt=""
              style={{ width: mm(b.anchoPuntos), display: 'block', margin: '0 auto' }}
            />
          )
        }

        if (b.tipo === 'qr') {
          // Del mismo tamaño que va a salir impreso: módulos × puntos por módulo
          const lado = modulosQr(b.contenido) * b.modulo
          return qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={qrUrl}
              alt="QR"
              style={{ width: mm(lado), height: mm(lado), display: 'block', margin: '0 auto' }}
            />
          ) : null
        }

        const cuerpo = b.chica ? CUERPO_CHICO : CUERPO_NORMAL
        const renglon = (b.chica ? RENGLON_CHICO : RENGLON_NORMAL) * b.alto

        const contenido = (
          <span
            style={{
              display: 'block',
              // La letra doble solo estira hacia abajo: el ancho de la grilla
              // no cambia, igual que en la impresora
              transform: b.alto === 2 ? 'scaleY(2)' : undefined,
              transformOrigin: 'center',
            }}
          >
            {b.texto === '' ? ' ' : b.texto}
          </span>
        )

        return (
          <div
            key={i}
            style={{
              fontSize: mm(cuerpo),
              lineHeight: mm(renglon),
              height: mm(renglon),
              fontWeight: b.negrita ? 700 : 400,
              textAlign: b.alinear === 'centro' ? 'center' : 'left',
              whiteSpace: 'pre',
              display: 'flex',
              alignItems: 'center',
              justifyContent: b.alinear === 'centro' ? 'center' : 'flex-start',
              overflow: 'hidden',
            }}
          >
            <span style={{ display: 'block', width: b.alinear === 'centro' ? undefined : '100%' }}>
              {contenido}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Ancho del ticket en milímetros; lo usan las páginas para el tamaño de papel. */
export const ANCHO_TICKET_MM = ANCHO_PUNTOS * PUNTO_MM

/** Columnas de la grilla, por si alguna página necesita medir texto. */
export { COLUMNAS }
