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

      // Una sola altura para todo el lote, la del ticket más largo.
      //
      // Se probó darle a cada ticket su propia página con nombre (@page
      // ficha-N) para que ninguno desperdiciara papel, pero al medir el PDF
      // resultante salían el doble de páginas: al cambiar de página con
      // nombre el navegador abre además una página para el contenido "por
      // defecto". Con una altura única el conteo sale exacto.
      tickets.forEach((t) => {
        // Solo 2 mm de holgura: todo exceso es papel botado en cada ticket
        const alto = Math.ceil(t.getBoundingClientRect().height / PX_POR_MM) + 2
        altoMaximo = Math.max(altoMaximo, alto)
      })

      // Escape hatch: si en alguna impresora hiciera falta un alto distinto,
      // se puede forzar desde la URL con ?altoMm=180 sin tocar el código.
      const forzado = Number(new URLSearchParams(location.search).get('altoMm'))
      if (forzado > 0) altoMaximo = forzado

      document.getElementById('page-size-ticket')?.remove()
      const style = document.createElement('style')
      style.id = 'page-size-ticket'
      style.textContent = `@media print {
        @page { size: 80mm ${altoMaximo}mm; margin: 0; }
        ${reglas.join('\n')}
      }`
      // IMPORTANTE: va al FINAL del body, no al head. El <style> de la página
      // se renderiza dentro del body, y entre reglas de igual peso gana la que
      // viene después en el documento: desde el head la nuestra quedaba pisada
      // y el papel se quedaba en el alto de respaldo.
      document.body.appendChild(style)
      document.body.dataset.altoTicket = String(altoMaximo)
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
