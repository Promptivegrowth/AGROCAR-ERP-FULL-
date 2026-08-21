'use client'

import { useState } from 'react'

/**
 * Ayuda para cuando la ticketera bota papel de más.
 *
 * El sistema pide una página de 80 mm de ancho por el alto exacto del ticket
 * —medido, no estimado: un ticket normal sale en 80 × 114 mm—, pero al
 * imprimir manda el tamaño de papel elegido en el diálogo, y el driver de la
 * POS-80 solo ofrece 80 × 210, 80 × 297 y 80 × 3276. Con el más corto de esos
 * tres, la impresora avanza 210 mm para un ticket de 114: casi un palmo en
 * blanco por venta.
 *
 * La salida es crear un formulario de papel a la medida en Windows, que
 * después aparece en esa misma lista. Los pasos van acá, donde se imprime.
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
            El sistema arma la página del alto justo del ticket (unos 114 mm). Al imprimir manda el
            tamaño elegido en <b>Tamaño de papel</b>, y el driver de la POS-80 solo trae
            80 × 210, 80 × 297 y 80 × 3276 mm. Con 80 × 210 —el más corto— la impresora igual avanza
            210 mm. Para que corte al terminar el ticket hay que crear un tamaño propio, una sola vez
            por computadora:
          </p>

          <p className="font-semibold mt-2">1. Crear el formulario en Windows</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li><b>Configuración</b> → <b>Bluetooth y dispositivos</b> → <b>Impresoras y escáneres</b>.</li>
            <li>Bajar hasta <b>Configuración relacionada</b> y abrir <b>Propiedades del servidor de impresión</b>.</li>
            <li>Pestaña <b>Formularios</b> → marcar <b>Crear un nuevo formulario</b>.</li>
            <li>Nombre: <b>Ticket 80x120</b>. Unidades: <b>Métrico</b>. Ancho <b>8,00 cm</b>, alto <b>12,00 cm</b>.
              Los cuatro márgenes en <b>0</b>.</li>
            <li><b>Guardar formulario</b> y cerrar.</li>
          </ol>

          <p className="font-semibold mt-2">2. Asignarlo a la ticketera</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>En <b>Impresoras y escáneres</b> abrir la <b>POS-80-Series</b> → <b>Preferencias de impresión</b>.</li>
            <li>En <b>Tamaño del papel</b> elegir <b>Ticket 80x120</b> y aceptar.</li>
            <li>Si el driver tiene <b>Corte de papel</b> o <b>Auto cut</b>, dejarlo en <b>Después de cada documento</b>.</li>
          </ol>

          <p className="font-semibold mt-2">3. Al imprimir</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>En <b>Tamaño de papel</b> del diálogo elegir <b>Ticket 80x120</b>.</li>
            <li><b>Escala</b> en <b>100</b> —no «Ajustar al área imprimible»— y <b>Márgenes</b> en <b>Predeterminado</b>.</li>
          </ol>

          <p className="mt-2 text-[11px]">
            Si el formulario nuevo no aparece en la lista, cerrar sesión de Windows y volver a entrar.
            Mientras tanto, de las tres opciones del driver la que menos papel bota es
            <b> 80 × 210</b>: nunca usar 80 × 3276, que avanza más de tres metros.
          </p>
        </div>
      )}
    </div>
  )
}
