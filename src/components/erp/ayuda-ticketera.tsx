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

          <p className="font-semibold mt-2">La causa real: el margen final del driver</p>
          <p className="mb-1">
            Estas ticketeras traen un <b>margen final</b> configurado en el driver —en la POS-80 de
            oficina venía en <b>30 mm</b>— que se agrega después de cada ticket. Eso es el papel en
            blanco, y no se ve desde el diálogo de impresión de Windows. Se baja a <b>3 mm</b>,
            que es el mínimo que acepta.
          </p>
          <p className="mb-1">
            La forma rápida es por PowerShell <b>como administrador</b>, cambiando
            <code> POS-80-Series</code> por el nombre de la impresora si fuera otro:
          </p>
          <pre className="bg-white border border-amber-300 rounded p-2 my-1 overflow-x-auto text-[10px] leading-relaxed">{`$P = "POS-80-Series"
Set-PrinterProperty -PrinterName $P -PropertyName "Config:zjTrailingMargin" -Value "zj3mm"
Set-PrinterProperty -PrinterName $P -PropertyName "Config:zjPaperCutting" -Value "Option2"`}</pre>
          <p className="mb-2">
            El margen solo acepta ciertos valores: <b>zj3mm</b>, zj12mm, zj15mm, zj18mm y zj30mm.
            Para el corte, si <b>Option2</b> no corta entre tickets, probar <b>Option4</b> y si no
            volver a <b>Option1</b>. Para ver cómo quedó:
            <code className="block mt-1">Get-PrinterProperty -PrinterName $P</code>
          </p>
          <p className="mb-2">
            En <b>Tamaño de papel</b> dejar <b>Thermal Paper (80 x 210)</b>. No usar el de 3276.
          </p>

          <p className="font-semibold mt-2">Si la impresora da Error y no imprime nada</p>
          <p className="mb-2">
            Suele ser que el driver quedó apuntando a un puerto que ya no existe. Pasó en la
            computadora de oficina: la impresora respondía en <b>USB001</b> y el driver seguía en
            <b> POS-80 PORT:</b>, así que todo trabajo entraba en error y trababa la cola. Se ve y se
            corrige así, como administrador:
          </p>
          <pre className="bg-white border border-amber-300 rounded p-2 my-1 overflow-x-auto text-[10px] leading-relaxed">{`Get-Printer -Name "POS-80-Series" | Select Name, PortName, PrinterStatus
Get-PrinterPort | Select Name, Description
Set-Printer -Name "POS-80-Series" -PortName "USB001"`}</pre>
          <p className="mb-2">
            Si quedan trabajos trabados que no se dejan cancelar: detener el servicio
            <b> Cola de impresión</b>, borrar todo lo que haya en
            <code> C:\Windows\System32\spool\PRINTERS</code> y volver a iniciarlo.
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
