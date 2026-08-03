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

    /**
     * Le da a CADA ticket una página del alto exacto de su contenido.
     *
     * Si a todo el lote se le pusiera el alto del ticket más largo, cada
     * ticket corto se llevaría la diferencia en papel en blanco. Con páginas
     * con nombre (@page ficha-N) cada uno avanza solo lo suyo.
     */
    const ajustarPagina = () => {
      if (!esTicket) return
      const tickets = Array.from(document.querySelectorAll<HTMLElement>('.pagebreak'))
      if (tickets.length === 0) return

      // px → mm (96 px por pulgada = 25.4 mm). Como el ticket ya se muestra a
      // 72 mm, el mismo ancho con el que se imprime, esta medida es la real.
      const PX_POR_MM = 96 / 25.4
      const reglas: string[] = []
      let altoMaximo = 0

      tickets.forEach((t, i) => {
        // Solo 2 mm de holgura: todo exceso es papel botado en cada ticket
        const alto = Math.ceil(t.getBoundingClientRect().height / PX_POR_MM) + 2
        altoMaximo = Math.max(altoMaximo, alto)
        t.classList.add(`ficha-${i}`)
        reglas.push(`@page ficha-${i} { size: 80mm ${alto}mm; margin: 0; }`)
        reglas.push(`.ficha-${i} { page: ficha-${i}; }`)
      })

      document.getElementById('page-size-ticket')?.remove()
      const style = document.createElement('style')
      style.id = 'page-size-ticket'
      // El @page suelto queda de respaldo por si el navegador no soporta
      // páginas con nombre: peor un alto único que volver a caer en A4.
      style.textContent = `@media print {
        @page { size: 80mm ${altoMaximo}mm; margin: 0; }
        ${reglas.join('\n')}
      }`
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
