'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Printer, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

export default function BalanceComprobacionPage() {
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
    const { data } = await (supabase.rpc as any)('balance_comprobacion', {
      p_desde: desde, p_hasta: hasta,
    })
    setReporte(data)
    setLoading(false)
  }, [supabase, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  const cuentas = (reporte?.cuentas ?? []) as any[]
  const totales = reporte?.totales ?? { total_debe: 0, total_haber: 0 }
  const diferencia = Number(totales.total_debe) - Number(totales.total_haber)
  const cuadrado = Math.abs(diferencia) < 0.01

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{`@media print {
        @page { size: A4 portrait; margin: 12mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
        table { font-size: 9pt !important; }
        th, td { padding: 3px 4px !important; }
      }`}</style>

      <div className="flex items-center gap-3 no-print">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Balance de Comprobación</h1>
          <p className="text-sm text-gray-500">Sumas y saldos por cuenta (solo asientos asentados)</p>
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

      {/* Indicador cuadre */}
      {!loading && reporte && (
        <div className={`rounded-lg p-3 border-2 ${cuadrado ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'} flex items-center justify-between flex-wrap gap-2 no-print`}>
          <div className="flex items-center gap-2">
            {cuadrado ? (
              <span className="text-green-800 font-bold">✓ Cuadrado</span>
            ) : (
              <span className="text-red-800 font-bold flex items-center gap-1">
                <AlertTriangle className="w-4 h-4" /> Descuadrado · Diferencia: {formatCurrency(Math.abs(diferencia))}
              </span>
            )}
          </div>
          <div className="text-xs">
            Total Debe: <strong>{formatCurrency(totales.total_debe)}</strong> ·
            Total Haber: <strong>{formatCurrency(totales.total_haber)}</strong>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : cuentas.length === 0 ? (
        <p className="text-center py-12 text-gray-400 text-sm">Sin movimientos asentados en el período</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden print:border-0">
          {/* Header impresión */}
          <div className="hidden print:block p-3 border-b-2 border-black">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold">{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</p>
                <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 14 }}>{EMPRESA.slogan}</p>
              </div>
              <div className="text-right text-xs">
                <p className="font-bold">BALANCE DE COMPROBACIÓN</p>
                <p>Del {formatDate(desde)} al {formatDate(hasta)}</p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto print:max-h-none print:overflow-visible">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="text-left p-2 font-semibold text-gray-600 w-20">Código</th>
                  <th className="text-left p-2 font-semibold text-gray-600">Cuenta</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-28">Saldo inicial</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-28">Debe</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-28">Haber</th>
                  <th className="text-right p-2 font-semibold text-gray-600 w-28">Saldo final</th>
                </tr>
              </thead>
              <tbody>
                {cuentas.map((c: any) => (
                  <tr key={c.cuenta_id} className="border-b border-gray-100">
                    <td className="p-1.5 font-mono">{c.codigo}</td>
                    <td className="p-1.5">{c.nombre}</td>
                    <td className="p-1.5 text-right font-mono">{Math.abs(c.saldo_inicial) > 0.01 ? formatCurrency(c.saldo_inicial) : ''}</td>
                    <td className="p-1.5 text-right font-mono">{Number(c.debe_periodo) > 0 ? formatCurrency(c.debe_periodo) : ''}</td>
                    <td className="p-1.5 text-right font-mono">{Number(c.haber_periodo) > 0 ? formatCurrency(c.haber_periodo) : ''}</td>
                    <td className="p-1.5 text-right font-mono font-semibold">{Math.abs(c.saldo_final) > 0.01 ? formatCurrency(c.saldo_final) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-bold sticky bottom-0">
                <tr>
                  <td colSpan={3} className="p-2 text-right">TOTALES</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(totales.total_debe)}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(totales.total_haber)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
