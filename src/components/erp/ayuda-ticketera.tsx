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

          <p className="font-semibold mt-2">Qué tamaño usar</p>
          <p className="mb-1">
            Dejar <b>Thermal Paper (80 x 210)</b>, que es el más corto de los tres. El ticket sale
            completo y correcto; lo que sobra es papel en blanco.
          </p>
          <p className="mb-2">
            <b>No usar 80 × 3276.</b> Ese tamaño existe para documentos de largo variable, pero si el
            driver no corta al terminar el contenido avanza más de tres metros, y el diálogo coloca
            la página centrada en el papel: saldría papel en blanco <i>antes</i> del ticket, que ya no
            se recupera. No compensa el riesgo.
          </p>

          <p className="font-semibold mt-2">Para que no sobre papel</p>
          <p>
            Ese driver no acepta tamaños personalizados: aunque se cree un formulario en Windows
            —Propiedades del servidor de impresión → Formularios— el driver no lo muestra. La única
            salida real es instalar el driver del fabricante de la ticketera (XPrinter, Gprinter,
            EPSON TM, según la marca), que sí permite definir el largo del papel.
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
