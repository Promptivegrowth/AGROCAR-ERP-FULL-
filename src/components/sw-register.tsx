'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker globalmente. Va en el layout raíz para que el SW
 * esté activo en TODAS las páginas (no solo /login).
 *
 * Además se ocupa de que una versión nueva se aplique sola. Antes solo dejaba
 * un aviso en la consola —que nadie ve— y el sistema seguía andando con la
 * copia guardada: el ERP quedaba actualizado en el servidor y la aplicación
 * instalada seguía comportándose como la versión vieja. Pasó con la impresión
 * de tickets, donde seguía abriéndose el diálogo que ya se había reemplazado.
 *
 * El propio sw.js maneja install/activate/fetch + cache offline.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV === 'development') return // no registrar en dev

    let recargando = false

    /**
     * Cuando el service worker nuevo toma el control, se recarga una vez.
     *
     * La bandera evita el bucle: sin ella, cada recarga puede disparar otra.
     */
    const alCambiar = () => {
      if (recargando) return
      recargando = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', alCambiar)

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          // Buscar versión nueva al abrir y cada media hora: una computadora de
          // oficina puede pasar días sin cerrarse, y así no se queda atrás.
          reg.update().catch(() => {})
          const reloj = setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000)

          reg.addEventListener('updatefound', () => {
            const nuevo = reg.installing
            if (!nuevo) return
            nuevo.addEventListener('statechange', () => {
              if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
                // Hay versión nueva lista: se activa sin esperar a que el
                // usuario cierre todas las ventanas.
                nuevo.postMessage({ tipo: 'aplicar-ya' })
              }
            })
          })

          window.addEventListener('beforeunload', () => clearInterval(reloj))
        })
        .catch((err) => console.warn('[PWA] Error al registrar SW:', err))
    }

    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad)

    return () => {
      window.removeEventListener('load', onLoad)
      navigator.serviceWorker.removeEventListener('controllerchange', alCambiar)
    }
  }, [])

  return null
}
