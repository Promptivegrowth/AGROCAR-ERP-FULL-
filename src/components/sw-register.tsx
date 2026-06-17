'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker globalmente. Va en el layout raíz para que
 * el SW esté activo en TODAS las páginas (no solo /login).
 *
 * El propio sw.js maneja install/activate/fetch + cache offline.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV === 'development') return // no registrar en dev

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          // Detectar actualizaciones del SW
          reg.addEventListener('updatefound', () => {
            const nuevo = reg.installing
            if (!nuevo) return
            nuevo.addEventListener('statechange', () => {
              if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
                // Hay una versión nueva esperando
                console.info('[PWA] Nueva versión disponible. Recarga para actualizar.')
              }
            })
          })
        })
        .catch((err) => console.warn('[PWA] Error al registrar SW:', err))
    }

    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad)
    return () => window.removeEventListener('load', onLoad)
  }, [])

  return null
}
