'use client'

import { useRouter } from 'next/navigation'
import { Printer, Calendar } from 'lucide-react'
import { hoyLima } from '@/lib/fechas-pe'

/**
 * Los mismos controles del reporte por persona, para el consolidado.
 *
 * Sin Excel: el reporte de cada persona ya lo tiene, y acá el documento es
 * para imprimir y repartir — cada uno arranca en su propia hoja.
 */
export default function EquipoReporteActions({
  desde, hasta,
}: { desde: string; hasta: string }) {
  const router = useRouter()
  const ir = (d: string, h: string) => router.push(`/reportes/equipo?desde=${d}&hasta=${h}`)

  const hoyStr = hoyLima()
  const restarDias = (n: number) => {
    const f = new Date(hoyStr + 'T12:00:00-05:00')
    f.setDate(f.getDate() - n)
    return f.toISOString().split('T')[0]
  }
  const ayerStr = restarDias(1)
  const semanaStr = restarDias(6)
  const mesStr = restarDias(29)

  const atajo = (etiqueta: string, d: string, h: string, activo: boolean) => (
    <button
      type="button"
      onClick={() => ir(d, h)}
      className={`px-2 py-1 text-[10px] font-semibold rounded border ${
        activo ? 'bg-white text-black border-white' : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
      }`}
    >
      {etiqueta}
    </button>
  )

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => ir(hoyStr, hoyStr)}
          className={`px-2 py-1 text-[10px] font-semibold rounded border ${
            desde === hoyStr && hasta === hoyStr
              ? 'bg-white text-black border-white'
              : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
          }`}
        >
          <Calendar className="w-3 h-3 inline mr-0.5" />Hoy
        </button>
        {atajo('Ayer', ayerStr, ayerStr, desde === ayerStr && hasta === ayerStr)}
        {atajo('7d', semanaStr, hoyStr, desde === semanaStr && hasta === hoyStr)}
        {atajo('30d', mesStr, hoyStr, desde === mesStr && hasta === hoyStr)}
      </div>

      <div className="flex items-center gap-1 text-xs">
        <label className="text-gray-300">Desde:</label>
        <input
          type="date"
          value={desde}
          max={hasta}
          onChange={(e) => ir(e.target.value, hasta)}
          className="h-7 text-[11px] px-1.5 border border-gray-400 rounded bg-white text-black"
        />
        <label className="text-gray-300 ml-1">Hasta:</label>
        <input
          type="date"
          value={hasta}
          min={desde}
          onChange={(e) => ir(desde, e.target.value)}
          className="h-7 text-[11px] px-1.5 border border-gray-400 rounded bg-white text-black"
        />
      </div>

      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]"
      >
        <Printer className="w-3 h-3" />
        Imprimir / PDF
      </button>
    </div>
  )
}
