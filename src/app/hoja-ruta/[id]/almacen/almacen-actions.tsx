'use client'

import Link from 'next/link'
import { Printer, Truck } from 'lucide-react'

export default function HojaRutaAlmacenActions({ despachoId }: { despachoId: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/hoja-ruta/${despachoId}`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        title="Ver hoja de ruta completa (con mapa, para conductor)"
      >
        <Truck className="w-3.5 h-3.5" />
        Hoja de ruta
      </Link>
      <Link
        href={`/hoja-ruta/${despachoId}/simple`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        title="Ver hoja simple para conductor"
      >
        🧾 Simple
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]"
      >
        <Printer className="w-3.5 h-3.5" />
        Imprimir
      </button>
    </div>
  )
}
