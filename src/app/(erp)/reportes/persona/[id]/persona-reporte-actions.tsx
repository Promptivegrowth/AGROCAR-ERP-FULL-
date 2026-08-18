'use client'

import { useRouter } from 'next/navigation'
import { Printer, FileSpreadsheet, Calendar } from 'lucide-react'
import { hoyLima } from '@/lib/fechas-pe'

export default function PersonaReporteActions({
  personaId, desde, hasta,
}: { personaId: string; desde: string; hasta: string }) {
  const router = useRouter()
  const setRango = (k: 'desde' | 'hasta', v: string) => {
    const otros = k === 'desde' ? { hasta } : { desde }
    router.push(`/reportes/persona/${personaId}?desde=${k === 'desde' ? v : otros.desde}&hasta=${k === 'hasta' ? v : otros.hasta}`)
  }
  const setRangoBoth = (d: string, h: string) => {
    router.push(`/reportes/persona/${personaId}?desde=${d}&hasta=${h}`)
  }
  const hoyStr = hoyLima()
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  const ayerStr = ayer.toISOString().split('T')[0]
  const semana = new Date()
  semana.setDate(semana.getDate() - 6)
  const semanaStr = semana.toISOString().split('T')[0]

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Atajos rápidos para los rangos más comunes */}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setRangoBoth(hoyStr, hoyStr)}
          className={`px-2 py-1 text-[10px] font-semibold rounded border ${
            desde === hoyStr && hasta === hoyStr
              ? 'bg-white text-black border-white'
              : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
          }`}
        >
          <Calendar className="w-3 h-3 inline mr-0.5" />Hoy
        </button>
        <button
          type="button"
          onClick={() => setRangoBoth(ayerStr, ayerStr)}
          className={`px-2 py-1 text-[10px] font-semibold rounded border ${
            desde === ayerStr && hasta === ayerStr
              ? 'bg-white text-black border-white'
              : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
          }`}
        >
          Ayer
        </button>
        <button
          type="button"
          onClick={() => setRangoBoth(semanaStr, hoyStr)}
          className="px-2 py-1 text-[10px] font-semibold rounded border bg-white/10 text-white border-white/30 hover:bg-white/20"
        >
          7d
        </button>
      </div>
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
          max={hoyStr}
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
