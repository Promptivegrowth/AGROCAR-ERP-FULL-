'use client'

import { useRouter } from 'next/navigation'
import { Printer, FileSpreadsheet } from 'lucide-react'

export default function PersonaReporteActions({
  personaId, desde, hasta,
}: { personaId: string; desde: string; hasta: string }) {
  const router = useRouter()
  const setRango = (k: 'desde' | 'hasta', v: string) => {
    const otros = k === 'desde' ? { hasta } : { desde }
    router.push(`/reportes/persona/${personaId}?desde=${k === 'desde' ? v : otros.desde}&hasta=${k === 'hasta' ? v : otros.hasta}`)
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1 text-xs">
        <label className="text-gray-300">Desde:</label>
        <input
          type="date"
          value={desde}
          max={hasta}
          onChange={(e) => setRango('desde', e.target.value)}
          className="h-7 text-[11px] px-1.5 border border-gray-400 rounded bg-white text-black"
        />
        <label className="text-gray-300 ml-1">Hasta:</label>
        <input
          type="date"
          value={hasta}
          min={desde}
          max={new Date().toISOString().split('T')[0]}
          onChange={(e) => setRango('hasta', e.target.value)}
          className="h-7 text-[11px] px-1.5 border border-gray-400 rounded bg-white text-black"
        />
      </div>
      <a
        href={`/api/reportes/persona/${personaId}/excel?desde=${desde}&hasta=${hasta}`}
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
