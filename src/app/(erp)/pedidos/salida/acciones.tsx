'use client'

import { useRouter } from 'next/navigation'
import { Printer } from 'lucide-react'
import { hoyLima } from '@/lib/fechas-pe'

/** Cambiar el día de despacho e imprimir. */
export default function SalidaAcciones({ fecha }: { fecha: string }) {
  const router = useRouter()
  const ir = (f: string) => router.push(`/pedidos/salida?fecha=${f}`)
  const dia = (n: number) => {
    const d = new Date(`${hoyLima()}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }
  return (
    <div className="flex items-end gap-2 flex-wrap print:hidden">
      <div>
        <p className="text-[10px] uppercase text-gray-500 mb-0.5">Día de despacho</p>
        <input type="date" value={fecha} onChange={(e) => e.target.value && ir(e.target.value)}
          className="h-9 px-2 border border-gray-300 rounded-md text-xs bg-white" data-fecha-salida />
      </div>
      <button type="button" onClick={() => ir(dia(0))}
        className="h-9 px-3 text-xs font-semibold border border-gray-300 rounded-md bg-white hover:bg-gray-50">Hoy</button>
      <button type="button" onClick={() => ir(dia(1))}
        className="h-9 px-3 text-xs font-semibold border border-gray-300 rounded-md bg-white hover:bg-gray-50">Mañana</button>
      <button type="button" onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]">
        <Printer className="w-4 h-4" /> Imprimir / PDF
      </button>
    </div>
  )
}
