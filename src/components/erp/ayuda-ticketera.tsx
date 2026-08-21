'use client'

import { useState } from 'react'

/**
 * Ayuda para cuando la ticketera bota papel de más.
 *
 * El sistema pide una página de 80 mm de ancho por el alto exacto del ticket
 * —medido, no estimado—, pero el diálogo de Windows imprime con el tamaño de
 * papel que tenga configurado el driver. Si el driver dice 80 × 297 mm, la
 * impresora avanza los 297 mm aunque el ticket mida 114: sale el ticket y
 * después un palmo de papel en blanco.
 *
 * Eso no se arregla desde la web, hay que tocar la configuración de la
 * impresora en Windows, así que los pasos van acá donde se imprime.
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
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 max-w-xl">
          <p className="font-semibold mb-1">El ticket mide bien; el papel extra lo agrega la impresora.</p>
          <p className="mb-2">
            El sistema pide una hoja de 80 mm de ancho por el alto justo del ticket. Si igual avanza
            de más, el tamaño de papel del driver es más largo. Se corrige una sola vez por equipo:
          </p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>Windows → <b>Configuración</b> → <b>Bluetooth y dispositivos</b> → <b>Impresoras y escáneres</b>.</li>
            <li>Abrir <b>POS-80-Series</b> (o el nombre de la ticketera) → <b>Preferencias de impresión</b>.</li>
            <li>En <b>Tamaño del papel</b> elegir el de <b>80&nbsp;mm</b> de ancho. Si la lista trae varios,
              usar el de rollo o recibo; si no hay ninguno, crear uno personalizado de <b>80 × 120 mm</b>.</li>
            <li>Si el driver tiene <b>Corte de papel</b> o <b>Auto cut</b>, dejarlo en <b>Después de cada documento</b>.</li>
            <li>Guardar y volver a imprimir.</li>
          </ol>
          <p className="mt-2">
            Al imprimir, en el diálogo verificar que <b>Impresora</b> sea la ticketera y no una A4, y que
            en <b>Más opciones</b> la escala esté en <b>100&nbsp;%</b> —no en «Ajustar a la página»—.
          </p>
        </div>
      )}
    </div>
  )
}
