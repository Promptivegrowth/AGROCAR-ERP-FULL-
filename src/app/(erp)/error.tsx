'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react'
import Link from 'next/link'

export default function ErpError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[ERP error boundary]', error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
          <AlertTriangle className="w-7 h-7 text-amber-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          Algo salió mal al cargar este módulo
        </h2>
        <p className="text-sm text-gray-600 mb-1">
          No te preocupes, tu sesión sigue activa. Solo esta pantalla tuvo un problema temporal.
        </p>
        {error?.message && (
          <p className="text-xs text-gray-400 font-mono mt-3 mb-4 bg-gray-50 border border-gray-100 rounded-lg p-3 break-words text-left">
            {error.message}
            {error.digest && <span className="block mt-1 text-[10px] text-gray-300">ID: {error.digest}</span>}
          </p>
        )}
        <div className="flex items-center justify-center gap-2 mt-5">
          <Button onClick={reset} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
            <RefreshCcw className="w-4 h-4" /> Reintentar
          </Button>
          <Link href="/dashboard">
            <Button variant="outline" className="gap-2">
              <Home className="w-4 h-4" /> Volver al inicio
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
