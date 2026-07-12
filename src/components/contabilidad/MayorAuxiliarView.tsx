'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Printer } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

interface Props {
  tipo: 'cliente' | 'proveedor' | 'tercero'
  id: string
  rpcName: string
}

export default function MayorAuxiliarView({ tipo, id, rpcName }: Props) {
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
    const params: any = { p_desde: desde, p_hasta: hasta }
    params[`p_${tipo}_id`] = id
    const { data } = await (supabase.rpc as any)(rpcName, params)
    setReporte(data)
    setLoading(false)
  }, [supabase, id, desde, hasta, tipo, rpcName])

  useEffect(() => { cargar() }, [cargar])

  const entidad = reporte?.[tipo] ?? {}
  const nombre = tipo === 'cliente' || tipo === 'proveedor'
    ? entidad.razon_social
    : `${entidad.nombres ?? ''} ${entidad.apellidos ?? ''}`.trim()
  const doc = tipo === 'cliente'
    ? (entidad.ruc || entidad.dni)
    : tipo === 'proveedor'
      ? entidad.ruc
      : `${entidad.tipo_doc ?? ''} ${entidad.numero_doc ?? ''}`.trim()

  // Calcular saldo acumulado por partida
  const movsConSaldo = reporte?.movimientos ? (() => {
    let saldo = Number(reporte.saldo_inicial ?? 0)
    return reporte.movimientos.map((m: any) => {
      // Para clientes/trabajadores: saldo deudor (D-H)
      // Para proveedores: saldo acreedor (H-D)
      const delta = tipo === 'proveedor'
        ? Number(m.haber) - Number(m.debe)
        : Number(m.debe) - Number(m.haber)
      saldo += delta
      return { ...m, saldo_acumulado: saldo }
    })
  })() : []

  const labelTipo = tipo === 'cliente' ? 'CLIENTE' : tipo === 'proveedor' ? 'PROVEEDOR' : 'TERCERO'

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
          <h1 className="text-2xl font-bold text-gray-900">Mayor Auxiliar</h1>
          <p className="text-sm text-gray-500">{labelTipo}: {nombre} · {doc}</p>
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

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden print:border-0">
          <div className="hidden print:block p-3 border-b-2 border-black">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold">{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</p>
                <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 14 }}>{EMPRESA.slogan}</p>
              </div>
              <div className="text-right text-xs">
                <p className="font-bold">MAYOR AUXILIAR — {labelTipo}</p>
                <p>Del {formatDate(desde)} al {formatDate(hasta)}</p>
              </div>
            </div>
            <p className="mt-2 font-bold">{nombre} · {doc}</p>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600 w-24">Fecha</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-32">Asiento</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-24">Cuenta</th>
                <th className="text-left p-2 font-semibold text-gray-600">Glosa</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Debe</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Haber</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {tipo !== 'tercero' && (
                <tr className="bg-gray-50 border-b border-gray-300 font-semibold">
                  <td colSpan={6} className="p-2 text-right">SALDO INICIAL</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(reporte?.saldo_inicial ?? 0)}</td>
                </tr>
              )}
              {movsConSaldo.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-6 text-gray-400">Sin movimientos en el período</td></tr>
              ) : movsConSaldo.map((m: any, i: number) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="p-2 font-mono text-xs">{formatDate(m.fecha)}</td>
                  <td className="p-2 font-mono text-xs">{m.numero}</td>
                  <td className="p-2 font-mono text-xs">{m.codigo}</td>
                  <td className="p-2 text-xs">{m.glosa_partida || m.glosa}</td>
                  <td className="p-2 text-right font-mono">{Number(m.debe) > 0 ? formatCurrency(m.debe) : ''}</td>
                  <td className="p-2 text-right font-mono">{Number(m.haber) > 0 ? formatCurrency(m.haber) : ''}</td>
                  <td className="p-2 text-right font-mono font-semibold">{formatCurrency(m.saldo_acumulado)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-bold">
              <tr>
                <td colSpan={4} className="p-2 text-right">TOTALES PERÍODO</td>
                <td className="p-2 text-right font-mono">{formatCurrency(reporte?.total_debe ?? 0)}</td>
                <td className="p-2 text-right font-mono">{formatCurrency(reporte?.total_haber ?? 0)}</td>
                <td className="p-2 text-right font-mono bg-[#FBE600]">
                  {formatCurrency(movsConSaldo.length > 0 ? movsConSaldo[movsConSaldo.length - 1].saldo_acumulado : (reporte?.saldo_inicial ?? 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
