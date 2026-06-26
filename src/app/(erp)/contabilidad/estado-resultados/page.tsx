'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Printer, TrendingUp, TrendingDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

export default function EstadoResultadosPage() {
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
    const { data } = await (supabase.rpc as any)('estado_resultados', {
      p_desde: desde, p_hasta: hasta,
    })
    setReporte(data)
    setLoading(false)
  }, [supabase, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  const utilidad = Number(reporte?.utilidad_operativa ?? 0)
  const margen = Number(reporte?.ingresos ?? 0) > 0
    ? (utilidad / Number(reporte.ingresos)) * 100 : 0

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{`@media print {
        @page { size: A4 portrait; margin: 14mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
      }`}</style>

      <div className="flex items-center gap-3 no-print">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Estado de Resultados</h1>
          <p className="text-sm text-gray-500">Ingresos − Gastos = Utilidad</p>
        </div>
        <button onClick={() => window.print()} disabled={loading}
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

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : reporte && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 print:border-0 print:p-0 space-y-4">
          {/* Header impresión */}
          <div className="hidden print:block pb-3 border-b-2 border-black">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-base">{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</p>
                <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 14 }}>{EMPRESA.slogan}</p>
              </div>
              <div className="text-right text-xs">
                <p className="font-bold">ESTADO DE RESULTADOS</p>
                <p>Del {formatDate(desde)} al {formatDate(hasta)}</p>
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 no-print">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-emerald-700 uppercase">INGRESOS</p>
              <p className="text-xl font-bold text-emerald-900">{formatCurrency(reporte.ingresos)}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-red-700 uppercase">GASTOS + COSTOS</p>
              <p className="text-xl font-bold text-red-900">
                {formatCurrency(Number(reporte.gastos) + Number(reporte.costos))}
              </p>
            </div>
            <div className={`rounded-lg p-3 border-2 ${utilidad >= 0 ? 'bg-[#FBE600] border-yellow-500' : 'bg-red-100 border-red-400'}`}>
              <p className="text-xs font-semibold uppercase flex items-center gap-1">
                {utilidad >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                UTILIDAD
              </p>
              <p className="text-xl font-bold">{formatCurrency(utilidad)}</p>
              <p className="text-[10px]">Margen: {margen.toFixed(1)}%</p>
            </div>
          </div>

          {/* Detalle */}
          <div className="space-y-4">
            {/* Ingresos */}
            <div>
              <h2 className="text-sm font-bold text-emerald-900 uppercase mb-2 pb-1 border-b border-emerald-300">
                INGRESOS
              </h2>
              <table className="w-full text-sm">
                <tbody>
                  {((reporte.detalle_ingresos ?? []) as any[]).map((d: any) => (
                    <tr key={d.codigo} className="border-b border-gray-100">
                      <td className="p-1.5 font-mono text-xs w-24">{d.codigo}</td>
                      <td className="p-1.5">{d.nombre}</td>
                      <td className="p-1.5 text-right font-mono">{formatCurrency(d.monto)}</td>
                    </tr>
                  ))}
                  {(reporte.detalle_ingresos ?? []).length === 0 && (
                    <tr><td colSpan={3} className="text-center py-4 text-gray-400 italic text-xs">Sin ingresos registrados</td></tr>
                  )}
                  <tr className="bg-emerald-50 border-t-2 border-emerald-400 font-bold">
                    <td colSpan={2} className="p-2 text-right">TOTAL INGRESOS</td>
                    <td className="p-2 text-right font-mono text-emerald-800">{formatCurrency(reporte.ingresos)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Gastos */}
            <div>
              <h2 className="text-sm font-bold text-red-900 uppercase mb-2 pb-1 border-b border-red-300">
                GASTOS Y COSTOS
              </h2>
              <table className="w-full text-sm">
                <tbody>
                  {((reporte.detalle_gastos ?? []) as any[]).map((d: any) => (
                    <tr key={d.codigo} className="border-b border-gray-100">
                      <td className="p-1.5 font-mono text-xs w-24">{d.codigo}</td>
                      <td className="p-1.5">{d.nombre}</td>
                      <td className="p-1.5 text-right font-mono">{formatCurrency(d.monto)}</td>
                    </tr>
                  ))}
                  {(reporte.detalle_gastos ?? []).length === 0 && (
                    <tr><td colSpan={3} className="text-center py-4 text-gray-400 italic text-xs">Sin gastos registrados</td></tr>
                  )}
                  <tr className="bg-red-50 border-t-2 border-red-400 font-bold">
                    <td colSpan={2} className="p-2 text-right">TOTAL GASTOS + COSTOS</td>
                    <td className="p-2 text-right font-mono text-red-800">
                      {formatCurrency(Number(reporte.gastos) + Number(reporte.costos))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Resultado */}
            <div className={`rounded-lg p-4 ${utilidad >= 0 ? 'bg-[#FBE600] border-2 border-yellow-500' : 'bg-red-50 border-2 border-red-400'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold uppercase">
                    {utilidad >= 0 ? 'UTILIDAD DEL PERÍODO' : 'PÉRDIDA DEL PERÍODO'}
                  </p>
                  <p className="text-xs text-gray-700">Antes de impuesto a la renta</p>
                </div>
                <p className="text-3xl font-bold">{formatCurrency(utilidad)}</p>
              </div>
            </div>

            <p className="text-xs text-gray-500 italic text-center">
              Reporte basado en asientos en estado ASENTADO. Borradores quedan fuera.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
