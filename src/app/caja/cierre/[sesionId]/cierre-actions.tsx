'use client'

import { Printer, FileSpreadsheet } from 'lucide-react'

export default function CierreActions({ sesionId }: { sesionId: string }) {
  return (
    <div className="flex items-center gap-2">
      <a
        href={`/api/caja/cierre/${sesionId}/excel`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-green-700 rounded-md hover:bg-green-800"
      >
        <FileSpreadsheet className="w-3.5 h-3.5" />
        Descargar Excel
      </a>
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
