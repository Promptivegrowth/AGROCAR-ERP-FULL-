'use client'

import { useState } from 'react'

/**
 * Ayuda para cuando la ticketera bota papel de más.
 *
 * El sistema arma la página del alto exacto del ticket —medido: unos
 * 80 × 114 mm—, pero al imprimir manda el tamaño de papel que tenga el driver.
 * El de la POS-80 solo expone 80 × 210, 80 × 297 y 80 × 3276 mm, y NO toma los
 * formularios personalizados de Windows: se probó creando "ticket 80x120" en
 * Propiedades del servidor de impresión y el driver siguió mostrando solo los
 * suyos. Por eso acá no se promete un tamaño a medida, sino lo que sí depende
 * de la impresora.
 */
export default function AyudaTicketera() {
  const [abierto, setAbierto] = useState(false)

  return (
    <div className="no-print">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="text-xs text-gray-600 hover:text-gray-900 underline"
      >
        ¿La ticketera bota papel de más?
      </button>

      {abierto && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 max-w-2xl text-left">
          <p className="font-semibold mb-1">El ticket mide bien; el papel de más lo agrega la impresora.</p>
          <p className="mb-2">
            El sistema arma la página del alto justo del ticket, unos 114 mm. La impresora avanza lo
            que diga su <b>tamaño de papel</b>, y el driver de la POS-80 solo trae tres:
            80 × 210, 80 × 297 y 80 × 3276 mm. Con 210 se botan unos 96 mm por venta.
          </p>

          <p className="font-semibold mt-2">Probar el modo rollo</p>
          <p className="mb-1">
            En estas impresoras el tamaño larguísimo —<b>80 × 3276</b>— suele ser el modo de rollo
            continuo: el driver corta al terminar el contenido en vez de avanzar los tres metros.
            Vale la pena probarlo con <b>un</b> ticket:
          </p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>En el diálogo de impresión, <b>Tamaño de papel</b> → <b>Thermal Paper (80 x 3276)</b>.</li>
            <li>Imprimir un solo ticket y mirar cuánto papel sale.</li>
            <li>Si corta al final del ticket, dejarlo así: es el tamaño correcto.</li>
            <li>Si avanza de más, volver a <b>80 × 210</b>, que es el que menos desperdicia de los tres.</li>
          </ol>

          <p className="font-semibold mt-2">Si el modo rollo no funciona</p>
          <p>
            Ese driver no acepta tamaños personalizados: aunque se cree un formulario en Windows
            —Propiedades del servidor de impresión → Formularios— el driver no lo muestra. La salida
            es instalar el driver del fabricante real de la ticketera (XPrinter, Gprinter, EPSON TM,
            según la marca), que sí permite definir el largo. Mientras tanto, con 80 × 210 el ticket
            sale completo y correcto; solo sobra papel.
          </p>

          <p className="mt-2 text-[11px]">
            Al imprimir, revisar siempre que <b>Escala</b> esté en <b>100</b> —no en «Ajustar al área
            imprimible»— y <b>Márgenes</b> en <b>Predeterminado</b>.
          </p>
        </div>
      )}
    </div>
  )
}
