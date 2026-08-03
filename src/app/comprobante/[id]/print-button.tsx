'use client'

import { useEffect } from 'react'

/**
 * Ajusta el tamaño de página al alto real del ticket antes de imprimir.
 *
 * `@page { size: 80mm auto }` NO es CSS válido: la especificación no permite
 * mezclar una medida con `auto`, así que el navegador descarta la regla y usa
 * su papel por defecto (A4). Midiendo el alto y escribiendo dos medidas la
 * regla sí vale, el ticket sale a 80 mm y el rollo avanza solo lo necesario.
 */
export function ajustarPaginaTicket() {
  const ticket = document.querySelector<HTMLElement>('.ticket')
  if (!ticket) return

  const PX_POR_MM = 96 / 25.4
  const altoMm = Math.ceil(ticket.getBoundingClientRect().height / PX_POR_MM) + 4

  document.getElementById('page-size-ticket')?.remove()
  const style = document.createElement('style')
  style.id = 'page-size-ticket'
  style.textContent = `@media print { @page { size: 80mm ${altoMm}mm; margin: 0; } }`
  document.head.appendChild(style)
}

export default function PrintButton() {
  // También cubre Ctrl+P y el menú del navegador, no solo el botón
  useEffect(() => {
    const onBefore = () => ajustarPaginaTicket()
    window.addEventListener('beforeprint', onBefore)
    return () => window.removeEventListener('beforeprint', onBefore)
  }, [])

  return (
    <button
      onClick={() => { ajustarPaginaTicket(); window.print() }}
      className="text-xs text-gray-500 hover:text-gray-700 underline"
    >
      Imprimir / Guardar como PDF
    </button>
  )
}
