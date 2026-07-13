'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Printer, MapPin } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

const COLOR_TIPO: Record<string, string> = {
  administrativo: 'bg-blue-100 text-blue-800',
  ventas: 'bg-emerald-100 text-emerald-800',
  produccion: 'bg-purple-100 text-purple-800',
  logistica: 'bg-amber-100 text-amber-800',
  operativo: 'bg-gray-100 text-gray-800',
  general: 'bg-gray-100 text-gray-600',
}

export default function ReporteCentrosCostoPage() {
  const router = useRouter()
  const supabase = createClient()
  const hoy = hoyLima()
  const desdeDefault = (() => {
    const d = new Date(hoy + 'T00:00:00-05:00'); d.setDate(1)
    return d.toISOString().slice(0, 10)
  })()
  const [desde, setDesde] = useState(desdeDefault)
  const [hasta, setHasta] = useState(hoy)
  const [reporte, setReporte] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await (supabase.rpc as any)('reporte_centro_costo', { p_desde: desde, p_hasta: hasta })
    setReporte(data)
    setLoading(false)
  }, [supabase, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  const centros = (reporte?.centros ?? []) as any[]
  const totIng = Number(reporte?.total_ingresos ?? 0)
  const totGas = Number(reporte?.total_gastos ?? 0)
  const resultado = totIng - totGas

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{`@media print {
        @page { size: A4 landscape; margin: 10mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
      }`}</style>

      <div className="flex items-center gap-3 no-print">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MapPin className="w-6 h-6 text-indigo-600" />
            Reporte por Centro de Costo
          </h1>
          <p className="text-sm text-gray-500">Ingresos y gastos segmentados por área</p>
        </div>
        <button onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]">
          <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3 no-print">
        <div>
          <Label className="text-xs">Desde</Label>
          <Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Hasta</Label>
          <Input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => setHasta(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 no-print">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <p className="text-xs uppercase font-semibold text-emerald-700">INGRESOS TOTALES</p>
          <p className="text-xl font-bold text-emerald-900">{formatCurrency(totIng)}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs uppercase font-semibold text-red-700">GASTOS TOTALES</p>
          <p className="text-xl font-bold text-red-900">{formatCurrency(totGas)}</p>
        </div>
        <div className={`rounded-lg p-3 border-2 ${resultado >= 0 ? 'bg-[#FBE600] border-yellow-500' : 'bg-red-100 border-red-400'}`}>
          <p className="text-xs uppercase font-semibold">RESULTADO NETO</p>
          <p className="text-xl font-bold">{formatCurrency(resultado)}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : centros.length === 0 ? (
        <p className="text-center py-12 text-gray-400 text-sm">Sin movimientos con CC en el período</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden print:border-0">
          <div className="hidden print:block p-3 border-b-2 border-black">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold">{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</p>
                <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 14 }}>{EMPRESA.slogan}</p>
              </div>
              <div className="text-right text-xs">
                <p className="font-bold">REPORTE POR CENTRO DE COSTO</p>
                <p>Del {formatDate(desde)} al {formatDate(hasta)}</p>
              </div>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600 w-24">Código</th>
                <th className="text-left p-2 font-semibold text-gray-600">Centro de costo</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-32">Tipo</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Ingresos</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Gastos</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-32">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {centros.map((c) => {
                const res = Number(c.ingresos) - Number(c.gastos)
                return (
                  <tr key={c.cc_id} className="border-b border-gray-100 hover:bg-gray-50/60">
                    <td className="p-2 font-mono font-bold">{c.codigo}</td>
                    <td className="p-2 font-medium">{c.nombre}</td>
                    <td className="p-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${COLOR_TIPO[c.tipo] ?? ''}`}>
                        {c.tipo}
                      </span>
                    </td>
                    <td className="p-2 text-right font-mono text-emerald-700">{formatCurrency(c.ingresos)}</td>
                    <td className="p-2 text-right font-mono text-red-700">{formatCurrency(c.gastos)}</td>
                    <td className={`p-2 text-right font-mono font-bold ${res >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                      {formatCurrency(res)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-bold">
              <tr>
                <td colSpan={3} className="p-2 text-right">TOTALES</td>
                <td className="p-2 text-right font-mono">{formatCurrency(totIng)}</td>
                <td className="p-2 text-right font-mono">{formatCurrency(totGas)}</td>
                <td className={`p-2 text-right font-mono ${resultado >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                  {formatCurrency(resultado)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
