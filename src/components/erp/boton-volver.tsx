'use client'

import { useRouter, usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

/**
 * Botón de volver global del ERP.
 *
 * Daniel: "aunque sea una flechita para regresar… en todas las opciones que
 * entramos". Vive en el marco y no en cada pantalla, así aparece en las más de
 * treinta sin tener que tocarlas una por una y sin que se olvide en las nuevas.
 *
 * No se muestra en las pantallas raíz de cada módulo (donde no hay a dónde
 * volver) ni al imprimir. Si la pantalla ya trae su propia flecha, esta queda
 * arriba del contenido y no estorba.
 */

// Pantallas de primer nivel: son destino del menú lateral, no tienen "atrás"
const RAICES = new Set([
  '/dashboard', '/pedidos', '/despacho', '/facturacion', '/caja', '/caja-chica',
  '/cobranzas', '/gps', '/vendedores', '/reportes', '/contabilidad',
  '/planillas', '/almacen', '/maestros', '/configuracion', '/solicitudes-cliente',
])

export default function BotonVolver() {
  const router = useRouter()
  const pathname = usePathname()

  if (!pathname || RAICES.has(pathname)) return null

  // Sube un nivel en la ruta: /maestros/zonas → /maestros
  const padre = pathname.split('/').slice(0, -1).join('/') || '/dashboard'

  return (
    <div className="print:hidden mb-3">
      <button
        type="button"
        onClick={() => {
          // history.back() respeta de dónde vino; si entró por URL directa
          // no hay historial y se cae al nivel superior de la ruta.
          if (window.history.length > 1) router.back()
          else router.push(padre)
        }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 hover:text-gray-900 shadow-sm"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Volver
      </button>
    </div>
  )
}
