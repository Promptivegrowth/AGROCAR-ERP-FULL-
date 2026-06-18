'use client'

import { Printer, FileSpreadsheet } from 'lucide-react'

export default function CobranzasVendedorActions({ vendedorId }: { vendedorId: string }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <a
        href={`/api/reportes/cobranzas-vendedor/${vendedorId}/excel`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-white bg-green-700 rounded-md hover:bg-green-800"
      >
        <FileSpreadsheet className="w-3 h-3" />
        Excel
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]"
      >
        <Printer className="w-3 h-3" />
        PDF
      </button>
    </div>
  )
}
