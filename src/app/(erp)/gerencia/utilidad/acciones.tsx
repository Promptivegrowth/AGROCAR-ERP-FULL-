'use client'

import { useRouter } from 'next/navigation'
import { Printer, FileSpreadsheet } from 'lucide-react'
import { hoyLima } from '@/lib/fechas-pe'

const RUTA = '/gerencia/utilidad'

function restarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

export default function AccionesUtilidad({ desde, hasta }: { desde: string; hasta: string }) {
  const router = useRouter()
  const ir = (d: string, h: string) => router.push(`${RUTA}?desde=${d}&hasta=${h}`)
  const hoy = hoyLima()
  const inicioMes = `${hoy.slice(0, 8)}01`
  const boton = 'px-2 py-1 text-[10px] font-semibold rounded border bg-white/10 text-white border-white/30 hover:bg-white/20'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-1">
        <button onClick={() => ir(hoy, hoy)} className={boton}>Hoy</button>
        <button onClick={() => ir(restarDias(hoy, 6), hoy)} className={boton}>7d</button>
        <button onClick={() => ir(inicioMes, hoy)} className={boton}>Este mes</button>
        <button onClick={() => ir(restarDias(hoy, 29), hoy)} className={boton}>30d</button>
      </div>
      <div className="flex items-center gap-1 text-xs">
        <label className="text-gray-300">Desde:</label>
        <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && ir(e.target.value, hasta)}
          className="h-7 text-[11px] px-1.5 border border-gray-400 rounded bg-white text-black" />
        <label className="text-gray-300 ml-1">Hasta:</label>
        <input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && ir(desde, e.target.value)}
          className="h-7 text-[11px] px-1.5 border border-gray-400 rounded bg-white text-black" />
      </div>
      <a href={`/api/gerencia/utilidad/excel?desde=${desde}&hasta=${hasta}`}
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
