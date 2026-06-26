'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Printer } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

interface Cuenta { id: string; codigo: string; nombre: string }

export default function LibroMayorPage() {
  const router = useRouter()
  const supabase = createClient()
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [cuentaId, setCuentaId] = useState('')
  const hoy = hoyLima()
  const desdeDefault = (() => {
    const d = new Date(hoy + 'T00:00:00-05:00'); d.setDate(1)
    return d.toISOString().slice(0, 10)
  })()
  const [desde, setDesde] = useState(desdeDefault)
  const [hasta, setHasta] = useState(hoy)
  const [reporte, setReporte] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('cuentas_contables')
        .select('id, codigo, nombre')
        .eq('activo', true).eq('es_movimiento', true)
        .order('codigo')
      setCuentas((data ?? []) as Cuenta[])
    })()
  }, [supabase])

  const cargar = useCallback(async () => {
    if (!cuentaId) { setReporte(null); return }
    setLoading(true)
    const { data } = await (supabase.rpc as any)('libro_mayor_cuenta', {
      p_cuenta_id: cuentaId, p_desde: desde, p_hasta: hasta,
    })
    setReporte(data)
    setLoading(false)
  }, [supabase, cuentaId, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  // Saldo acumulado por fila
  const movsConSaldo = reporte?.movimientos ? (() => {
    const saldoNat = reporte.cuenta.saldo_natural
    let saldo = Number(reporte.saldo_inicial ?? 0)
    return reporte.movimientos.map((m: any) => {
      const delta = saldoNat === 'D' ? Number(m.debe) - Number(m.haber) : Number(m.haber) - Number(m.debe)
      saldo += delta
      return { ...m, saldo_acumulado: saldo }
    })
  })() : []

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{`@media print {
        @page { size: A4 portrait; margin: 12mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
      }`}</style>

      <div className="flex items-center gap-3 no-print">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Libro Mayor</h1>
          <p className="text-sm text-gray-500">Movimientos y saldo acumulado por cuenta</p>
        </div>
        <button onClick={() => window.print()} disabled={!reporte}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100] disabled:opacity-40">
          <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3 no-print">
        <div className="flex-1 min-w-[280px]">
          <Label className="text-xs">Cuenta contable *</Label>
          <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}
            className="mt-1 w-full h-9 px-2 text-sm border border-gray-300 rounded-md bg-white">
            <option value="">— Selecciona una cuenta —</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>
            ))}
          </select>
        </div>
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
      ) : !reporte ? (
        <p className="text-center py-12 text-gray-400 text-sm no-print">Selecciona una cuenta para ver sus movimientos.</p>
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
                <p className="font-bold">LIBRO MAYOR</p>
                <p>Del {formatDate(desde)} al {formatDate(hasta)}</p>
              </div>
            </div>
            <p className="mt-2 font-bold">
              Cuenta {reporte.cuenta.codigo} - {reporte.cuenta.nombre}
            </p>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600 w-24">Fecha</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-32">Asiento</th>
                <th className="text-left p-2 font-semibold text-gray-600">Glosa</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Debe</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Haber</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Saldo</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-gray-50 border-b border-gray-300 font-semibold">
                <td colSpan={5} className="p-2 text-right">SALDO INICIAL</td>
                <td className="p-2 text-right font-mono">{formatCurrency(reporte.saldo_inicial)}</td>
              </tr>
              {movsConSaldo.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-6 text-gray-400">Sin movimientos en el período</td></tr>
              ) : movsConSaldo.map((m: any, i: number) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="p-2 font-mono text-xs">{formatDate(m.fecha)}</td>
                  <td className="p-2 font-mono text-xs">{m.asiento_numero}</td>
                  <td className="p-2 text-xs">{m.glosa_partida || m.glosa}</td>
                  <td className="p-2 text-right font-mono">{Number(m.debe) > 0 ? formatCurrency(m.debe) : ''}</td>
                  <td className="p-2 text-right font-mono">{Number(m.haber) > 0 ? formatCurrency(m.haber) : ''}</td>
                  <td className="p-2 text-right font-mono font-semibold">{formatCurrency(m.saldo_acumulado)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-bold">
              <tr>
                <td colSpan={3} className="p-2 text-right">TOTALES PERÍODO</td>
                <td className="p-2 text-right font-mono">{formatCurrency(reporte.total_debe)}</td>
                <td className="p-2 text-right font-mono">{formatCurrency(reporte.total_haber)}</td>
                <td className="p-2 text-right font-mono bg-[#FBE600]">
                  {formatCurrency(movsConSaldo.length > 0 ? movsConSaldo[movsConSaldo.length - 1].saldo_acumulado : reporte.saldo_inicial)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
