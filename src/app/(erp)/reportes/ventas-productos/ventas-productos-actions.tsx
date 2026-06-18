'use client'

import { useRouter } from 'next/navigation'
import { Printer, FileSpreadsheet } from 'lucide-react'

export default function VentasProductosActions({ desde, hasta }: { desde: string; hasta: string }) {
  const router = useRouter()
  const setRango = (k: 'desde' | 'hasta', v: string) => {
    const otros = k === 'desde' ? { hasta } : { desde }
    router.push(`/reportes/ventas-productos?desde=${k === 'desde' ? v : otros.desde}&hasta=${k === 'hasta' ? v : otros.hasta}`)
  }
  const hoyStr = new Date().toISOString().split('T')[0]
  const setQuick = (dias: number) => {
    const d = new Date(); d.setDate(d.getDate() - dias)
    router.push(`/reportes/ventas-productos?desde=${d.toISOString().slice(0, 10)}&hasta=${hoyStr}`)
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-1">
        <button onClick={() => setQuick(0)} className="px-2 py-1 text-[10px] font-semibold rounded border bg-white/10 text-white border-white/30 hover:bg-white/20">Hoy</button>
        <button onClick={() => setQuick(6)} className="px-2 py-1 text-[10px] font-semibold rounded border bg-white/10 text-white border-white/30 hover:bg-white/20">7d</button>
        <button onClick={() => setQuick(29)} className="px-2 py-1 text-[10px] font-semibold rounded border bg-white/10 text-white border-white/30 hover:bg-white/20">30d</button>
        <button onClick={() => setQuick(89)} className="px-2 py-1 text-[10px] font-semibold rounded border bg-white/10 text-white border-white/30 hover:bg-white/20">90d</button>
      </div>
      <div className="flex items-center gap-1 text-xs">
        <label className="text-gray-300">Desde:</label>
        <input type="date" value={desde} max={hasta} onChange={(e) => setRango('desde', e.target.value)}
          className="h-7 text-[11px] px-1.5 border border-gray-400 rounded bg-white text-black" />
        <label className="text-gray-300 ml-1">Hasta:</label>
        <input type="date" value={hasta} min={desde} max={hoyStr} onChange={(e) => setRango('hasta', e.target.value)}
          className="h-7 text-[11px] px-1.5 border border-gray-400 rounded bg-white text-black" />
      </div>
      <a href={`/api/reportes/ventas-productos/excel?desde=${desde}&hasta=${hasta}`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-white bg-green-700 rounded-md hover:bg-green-800">
        <FileSpreadsheet className="w-3 h-3" />Excel
      </a>
      <button type="button" onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]">
        <Printer className="w-3 h-3" />PDF
      </button>
    </div>
  )
}
