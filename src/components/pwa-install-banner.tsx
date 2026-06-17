'use client'

import { useEffect, useState } from 'react'
import { Download, X, Smartphone, Monitor } from 'lucide-react'

/**
 * Banner de instalación de la PWA.
 *
 * Muestra el botón "Instalar" si el navegador soporta beforeinstallprompt
 * (Chrome / Edge / Brave) y la app no está ya instalada. En iOS Safari
 * muestra instrucciones manuales porque no soporta el prompt nativo.
 *
 * También registra el service worker al montarse.
 */
export default function PwaInstallBanner({ variant = 'login' }: { variant?: 'login' | 'floating' }) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [installed, setInstalled] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [showIOSHint, setShowIOSHint] = useState(false)

  useEffect(() => {
    // ── Registrar service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[PWA] No se pudo registrar el service worker:', err)
      })
    }

    // ── Detectar plataforma y estado
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true
    if (standalone) {
      setInstalled(true)
      return
    }

    const ua = navigator.userAgent.toLowerCase()
    const isIos = /iphone|ipad|ipod/.test(ua) && !/chrome|crios|edgios/.test(ua)
    setIsIOS(isIos)

    // ── Recordar si el usuario lo cerró antes
    const wasDismissed = localStorage.getItem('agrocar_pwa_dismissed') === '1'
    setDismissed(wasDismissed)

    // ── Capturar el prompt cuando Chrome/Edge lo emite
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)

    // ── Marcar como instalado cuando el usuario completa
    const onInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
      localStorage.removeItem('agrocar_pwa_dismissed')
    }
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed || dismissed) return null
  // Si no hay prompt nativo y no es iOS, no mostramos nada
  // (otros navegadores como Firefox no soportan instalación)
  if (!deferredPrompt && !isIOS) return null

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const result = await deferredPrompt.userChoice
      if (result.outcome === 'accepted') {
        setDeferredPrompt(null)
      }
    } else if (isIOS) {
      setShowIOSHint(true)
    }
  }

  const handleDismiss = () => {
    localStorage.setItem('agrocar_pwa_dismissed', '1')
    setDismissed(true)
  }

  // ── Hint iOS (no hay prompt nativo)
  if (showIOSHint) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold mb-1">Para instalar en iPhone/iPad:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Pulsa el botón <strong>Compartir</strong> ⬆️ abajo</li>
              <li>Elige <strong>&ldquo;Añadir a pantalla de inicio&rdquo;</strong></li>
              <li>Pulsa <strong>Añadir</strong> en la esquina superior derecha</li>
            </ol>
          </div>
          <button onClick={() => setShowIOSHint(false)} className="text-amber-700 hover:text-amber-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  // ── Variante login: card destacado
  if (variant === 'login') {
    return (
      <div className="bg-white border border-yellow-300 rounded-xl p-3 shadow-sm relative">
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
          aria-label="Cerrar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#FBE600] rounded-lg flex items-center justify-center flex-shrink-0">
            <Download className="w-5 h-5 text-black" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-gray-900">Instalar AGROCAR</p>
            <p className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
              <Monitor className="w-3 h-3" />
              <Smartphone className="w-3 h-3" />
              Acceso directo desde tu escritorio o pantalla de inicio
            </p>
          </div>
          <button
            onClick={handleInstall}
            className="bg-[#FBE600] hover:bg-[#E5D100] text-black text-xs font-bold px-3 py-1.5 rounded-md flex-shrink-0"
          >
            Instalar
          </button>
        </div>
      </div>
    )
  }

  // ── Variante flotante (para usar dentro de la app si quisiéramos)
  return (
    <div className="fixed bottom-4 right-4 bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-xs z-50">
      <div className="flex items-center gap-2">
        <Download className="w-4 h-4 text-[#FBE600]" />
        <p className="text-xs font-semibold flex-1">Instalar AGROCAR</p>
        <button onClick={handleDismiss} className="text-gray-400 hover:text-gray-600">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <button
        onClick={handleInstall}
        className="w-full mt-2 bg-[#FBE600] hover:bg-[#E5D100] text-black text-xs font-bold py-1.5 rounded-md"
      >
        Instalar app
      </button>
    </div>
  )
}
