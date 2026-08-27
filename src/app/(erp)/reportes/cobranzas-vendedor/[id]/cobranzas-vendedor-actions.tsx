'use client'

import Link from 'next/link'
import { Printer, FileSpreadsheet, Rows3 } from 'lucide-react'

export default function CobranzasVendedorActions({ vendedorId }: { vendedorId: string }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* La vista simple es la que se imprime: una linea por documento y sin
          firmas. Esta gasta media hoja por cliente. */}
      <Link
        href={`/reportes/cobranzas-vendedor/${vendedorId}/simple`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-gray-800 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
      >
        <Rows3 className="w-3 h-3" />
        Vista simple
      </Link>
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
