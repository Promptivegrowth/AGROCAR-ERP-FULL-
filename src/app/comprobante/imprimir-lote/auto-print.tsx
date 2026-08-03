'use client'

import { useEffect } from 'react'

/**
 * Dispara window.print() cuando el logo y los QR ya cargaron.
 *
 * Además, en formato ticket ajusta el TAMAÑO DE PÁGINA al alto real del
 * comprobante. Es necesario porque `@page { size: 80mm auto }` NO es CSS
 * válido —la especificación no deja mezclar una medida con `auto`— y el
 * navegador descarta la regla entera y se va a su papel por defecto (A4).
 * Midiendo el alto y escribiendo `size: 80mm <alto>mm` la regla sí es válida,
 * el ticket sale a 80 mm y el rollo avanza solo lo que ocupa.
 */
export default function AutoPrint({ count, esTicket }: { count: number; esTicket?: boolean }) {
  useEffect(() => {
    if (count === 0) return
    let cancelled = false

    /** Fija el alto de página al del ticket más largo del lote */
    const ajustarPagina = () => {
      if (!esTicket) return
      const tickets = Array.from(document.querySelectorAll<HTMLElement>('.pagebreak'))
      if (tickets.length === 0) return

      // px → mm usando el DPI del navegador (96 px por pulgada = 25.4 mm)
      const PX_POR_MM = 96 / 25.4
      const altoMaxPx = Math.max(...tickets.map((t) => t.getBoundingClientRect().height))
      // Un pelín de holgura para que la última línea nunca se corte
      const altoMm = Math.ceil(altoMaxPx / PX_POR_MM) + 4

      const anterior = document.getElementById('page-size-ticket')
      if (anterior) anterior.remove()

      const style = document.createElement('style')
      style.id = 'page-size-ticket'
      style.textContent = `@media print { @page { size: 80mm ${altoMm}mm; margin: 0; } }`
      document.head.appendChild(style)
    }

    // Esperar a que las imágenes (logo + QR) terminen de cargar: si se mide
    // antes, el alto sale corto y el ticket se parte en dos páginas.
    const imgs = Array.from(document.querySelectorAll('img'))
    const waits = imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) resolve()
          else {
            img.addEventListener('load', () => resolve(), { once: true })
            img.addEventListener('error', () => resolve(), { once: true })
          }
        }),
    )

    Promise.all(waits).then(() => {
      if (cancelled) return
      setTimeout(() => {
        if (cancelled) return
        ajustarPagina()
        window.print()
      }, 400)
    })

    // Botón "Imprimir otra vez": vuelve a medir por si cambió el zoom
    const btn = document.getElementById('reprintBtn')
    const onClick = () => { ajustarPagina(); window.print() }
    btn?.addEventListener('click', onClick)

    // Cubre también Ctrl+P y el menú del navegador
    const onBefore = () => ajustarPagina()
    window.addEventListener('beforeprint', onBefore)

    return () => {
      cancelled = true
      btn?.removeEventListener('click', onClick)
      window.removeEventListener('beforeprint', onBefore)
      document.getElementById('page-size-ticket')?.remove()
    }
  }, [count, esTicket])

  return null
}
