'use client'

import { useRouter } from 'next/navigation'
import { Printer } from 'lucide-react'

export default function RendicionActions({ fechaActual }: { fechaActual: string }) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-600">Fecha:</label>
      <input
        type="date"
        value={fechaActual}
        max={new Date().toISOString().split('T')[0]}
        onChange={(e) => router.push(`/reportes/rendicion-diaria?fecha=${e.target.value}`)}
        className="h-8 text-xs px-2 border border-gray-300 rounded-md bg-white"
      />
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]"
      >
        <Printer className="w-3.5 h-3.5" />
        Imprimir / PDF
      </button>
    </div>
  )
}
