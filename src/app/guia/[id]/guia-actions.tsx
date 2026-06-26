'use client'

import { Printer } from 'lucide-react'

export default function GuiaActions({ guiaId: _guiaId, numero }: { guiaId: string; numero: string }) {
  return (
    <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2.5 mb-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div>
          <h1 className="font-bold text-gray-900 text-sm">Guía de Remisión Electrónica</h1>
          <p className="text-[11px] text-gray-500 font-mono">{numero}</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]"
        >
          <Printer className="w-3.5 h-3.5" />
          Imprimir / PDF
        </button>
      </div>
    </div>
  )
}
