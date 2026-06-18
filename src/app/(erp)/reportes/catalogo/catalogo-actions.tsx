'use client'

import { useRouter } from 'next/navigation'
import { Printer, FileSpreadsheet } from 'lucide-react'

export default function CatalogoActions({ soloActivos }: { soloActivos: boolean }) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="flex items-center gap-1.5 text-xs text-white cursor-pointer">
        <input
          type="checkbox"
          checked={soloActivos}
          onChange={(e) => router.push(`/reportes/catalogo?activos=${e.target.checked ? '1' : '0'}`)}
          className="w-3.5 h-3.5 accent-yellow-400"
        />
        Solo activos
      </label>
      <a
        href={`/api/reportes/catalogo/excel?activos=${soloActivos ? '1' : '0'}`}
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
