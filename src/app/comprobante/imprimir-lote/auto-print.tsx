'use client'

import { useEffect } from 'react'

/**
 * Dispara window.print() una vez todos los recursos (logo, QRs) están cargados.
 * Si el usuario cancela el diálogo, puede volver a imprimir con el botón "Imprimir otra vez".
 */
export default function AutoPrint({ count }: { count: number }) {
  useEffect(() => {
    if (count === 0) return
    let cancelled = false

    // Esperar a que las imágenes (logos + QR) terminen de cargar antes de imprimir
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
      // Pequeño retraso adicional para evitar parpadeos en navegadores lentos
      setTimeout(() => {
        if (!cancelled) window.print()
      }, 400)
    })

    // Botón "Imprimir otra vez"
    const btn = document.getElementById('reprintBtn')
    const onClick = () => window.print()
    btn?.addEventListener('click', onClick)

    return () => {
      cancelled = true
      btn?.removeEventListener('click', onClick)
    }
  }, [count])

  return null
}
