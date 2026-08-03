'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCcw, Download, Loader2 } from 'lucide-react'
import { esErrorDeVersion, recargarAplicativo } from '@/lib/chunk-error'

/**
 * Red de seguridad del aplicativo. En el celular el problema más común es que
 * el service worker sirva una versión vieja después de una actualización; ahí
 * no basta con recargar, hay que soltar la caché.
 */
export default function PwaError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const esVersion = esErrorDeVersion(error)
  const [trabajando, setTrabajando] = useState(false)

  useEffect(() => {
    console.error('[PWA error boundary]', error)
    if (esVersion) {
      recargarAplicativo().then((r) => setTrabajando(r))
    }
  }, [error, esVersion])

  const actualizar = async () => {
    setTrabajando(true)
    // Forzamos aunque el candado esté puesto: lo pidió la persona a propósito
    try { sessionStorage.removeItem('agrocar:recarga-por-version') } catch {}
    await recargarAplicativo()
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
      <div className="max-w-xs w-full text-center">
        <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
          esVersion ? 'bg-blue-100' : 'bg-amber-100'
        }`}>
          {trabajando ? (
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          ) : esVersion ? (
            <Download className="w-8 h-8 text-blue-600" />
          ) : (
            <AlertTriangle className="w-8 h-8 text-amber-600" />
          )}
        </div>

        <h2 className="text-lg font-bold text-gray-900 mb-2">
          {esVersion ? 'Hay una versión nueva' : 'Algo salió mal'}
        </h2>
        <p className="text-sm text-gray-600 mb-5">
          {trabajando
            ? 'Actualizando… espera un momento.'
            : esVersion
              ? 'Toca actualizar para bajar la versión nueva. No pierdes nada de lo que registraste.'
              : 'Tu sesión sigue activa. Vuelve a intentarlo.'}
        </p>

        {!trabajando && (
          <div className="space-y-2">
            {esVersion ? (
              <button onClick={actualizar}
                className="w-full h-12 bg-[#FBE600] active:bg-[#E5D100] text-black font-bold rounded-xl">
                Actualizar ahora
              </button>
            ) : (
              <>
                <button onClick={reset}
                  className="w-full h-12 bg-[#FBE600] active:bg-[#E5D100] text-black font-bold rounded-xl flex items-center justify-center gap-2">
                  <RefreshCcw className="w-4 h-4" /> Reintentar
                </button>
                <button onClick={actualizar}
                  className="w-full h-11 border border-gray-300 text-gray-700 font-semibold rounded-xl">
                  Actualizar la app
                </button>
              </>
            )}
          </div>
        )}

        <p className="text-[11px] text-gray-400 mt-5">
          Si sigue igual, cierra la app por completo y vuelve a abrirla.
        </p>
      </div>
    </div>
  )
}
