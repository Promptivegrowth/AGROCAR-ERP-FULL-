'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Printer } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import LiquidacionDiaDialog from './liquidacion-dia-dialog'

/**
 * Cobranza acumulada entre dos fechas, por medio de pago (Daniel, 05/10): cuánto
 * entró en efectivo, Yape, Plin y transferencia en un rango, por cobrador y por
 * día. Caja solo mostraba el día. Lo suma la base (cobranza_acumulada) para no
 * chocar con el tope de mil filas.
 */

type Fila = { cobros: number; efectivo: number; yape: number; plin: number; transferencia: number; total: number }
type Datos = {
  total: Fila
  por_cobrador: (Fila & { cobrador: string; rol: string | null })[]
  por_dia: (Fila & { fecha: string })[]
}

const MEDIOS = [
  { clave: 'efectivo', label: 'Efectivo', color: 'bg-green-50 border-green-200 text-green-900' },
  { clave: 'yape', label: 'Yape', color: 'bg-purple-50 border-purple-200 text-purple-900' },
  { clave: 'plin', label: 'Plin', color: 'bg-blue-50 border-blue-200 text-blue-900' },
  { clave: 'transferencia', label: 'Transferencia', color: 'bg-orange-50 border-orange-200 text-orange-900' },
] as const

const ROL: Record<string, string> = { vendedor: 'Vendedor', repartidor: 'Repartidor', chofer: 'Chofer' }

function restarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}
function mesAnterior(hoy: string): [string, string] {
  const d = new Date(`${hoy.slice(0, 8)}01T12:00:00Z`)
  d.setUTCDate(0)
  const fin = d.toISOString().slice(0, 10)
  return [`${fin.slice(0, 8)}01`, fin]
}

export default function AcumuladoCaja() {
  const supabase = createClient()
  const hoy = hoyLima()
  const [desde, setDesde] = useState(`${hoy.slice(0, 8)}01`)
  const [hasta, setHasta] = useState(hoy)
  const [datos, setDatos] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  // Día abierto en el detalle de liquidación (Daniel, 07/10).
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!desde || !hasta || hasta < desde) return
    setCargando(true); setError('')
    const { data, error: e } = await (supabase.rpc as any)('cobranza_acumulada', { p_desde: desde, p_hasta: hasta })
    setCargando(false)
    if (e) { setError(e.message); setDatos(null); return }
    const n = (o: any): Fila => ({
      cobros: Number(o.cobros ?? 0), efectivo: Number(o.efectivo ?? 0), yape: Number(o.yape ?? 0),
      plin: Number(o.plin ?? 0), transferencia: Number(o.transferencia ?? 0), total: Number(o.total ?? 0),
    })
    setDatos({
      total: n(data.total),
      por_cobrador: (data.por_cobrador ?? []).map((x: any) => ({ ...n(x), cobrador: x.cobrador, rol: x.rol })),
      por_dia: (data.por_dia ?? []).map((x: any) => ({ ...n(x), fecha: x.fecha })),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  const atajos: [string, string, string][] = [
    ['Hoy', hoy, hoy],
    ['7 días', restarDias(hoy, 6), hoy],
    ['Este mes', `${hoy.slice(0, 8)}01`, hoy],
    ['Mes anterior', ...mesAnterior(hoy)],
  ]
  const boton = (activo: boolean) => `rounded-md border px-2.5 py-1 text-xs font-semibold ${activo
    ? 'border-[#FBE600] bg-[#FBE600] text-black' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`
  const celdas = (f: Fila, fuerte = false) => (
    <>
      <td className="py-2 px-3 text-right">{f.cobros}</td>
      {MEDIOS.map((m) => (
        <td key={m.clave} className="py-2 px-3 text-right font-mono text-xs">
          {f[m.clave] > 0 ? formatCurrency(f[m.clave]) : <span className="text-gray-300">—</span>}
        </td>
      ))}
      <td className={`py-2 px-3 text-right font-mono ${fuerte ? 'font-bold' : 'font-semibold text-green-700'}`}>{formatCurrency(f.total)}</td>
    </>
  )
  const encabezado = (primera: string) => (
    <thead className="border-b border-gray-100 bg-gray-50/50">
      <tr>
        {[primera, 'N° cobros', ...MEDIOS.map((m) => m.label), 'Total'].map((h, i) => (
          <th key={h} className={`py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
        ))}
      </tr>
    </thead>
  )

  return (
    <div className="space-y-4" data-acumulado-caja>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body * { visibility: hidden; }
          [data-acumulado-caja], [data-acumulado-caja] * { visibility: visible; }
          [data-acumulado-caja] { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      ` }} />
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="flex flex-wrap gap-1 no-print">
            {atajos.map(([t, d, h]) => (
              <button key={t} type="button" onClick={() => { setDesde(d); setHasta(h) }} className={boton(desde === d && hasta === h)}>{t}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-xs">
            <label className="text-gray-500">Desde</label>
            <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)}
              className="h-8 rounded border border-gray-300 px-1.5 text-xs" data-desde />
            <label className="ml-1 text-gray-500">Hasta</label>
            <input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)}
              className="h-8 rounded border border-gray-300 px-1.5 text-xs" data-hasta />
          </div>
          {cargando && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          <button type="button" onClick={() => window.print()}
            className="no-print ml-auto inline-flex items-center gap-1 rounded-md bg-[#FBE600] px-2.5 py-1 text-xs font-semibold text-black hover:bg-[#E5D100]">
            <Printer className="h-3.5 w-3.5" /> Imprimir
          </button>
        </CardContent>
      </Card>

      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {datos && (
        <>
          <p className="text-sm font-semibold text-gray-700">
            Cobranza del {formatDate(desde)} al {formatDate(hasta)} · {datos.total.cobros} cobros
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {MEDIOS.map((m) => (
              <div key={m.clave} className={`rounded-lg border p-3 ${m.color}`} data-medio={m.clave}>
                <p className="text-xs font-semibold uppercase">{m.label}</p>
                <p className="text-lg font-bold">{formatCurrency(datos.total[m.clave])}</p>
                <p className="text-[11px] opacity-70">
                  {datos.total.total > 0 ? `${((datos.total[m.clave] / datos.total.total) * 100).toFixed(1)}% del total` : '—'}
                </p>
              </div>
            ))}
            <div className="col-span-2 rounded-lg border border-yellow-400 bg-[#FBE600] p-3 md:col-span-1" data-medio="total">
              <p className="text-xs font-semibold uppercase">Total cobrado</p>
              <p className="text-lg font-bold">{formatCurrency(datos.total.total)}</p>
              <p className="text-[11px]">{datos.total.cobros} cobros</p>
            </div>
          </div>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-base font-semibold text-gray-800">Por cobrador</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  {encabezado('Cobrador')}
                  <tbody className="divide-y divide-gray-50">
                    {datos.por_cobrador.map((c) => (
                      <tr key={c.cobrador} className="hover:bg-gray-50/50">
                        <td className="py-2 px-3 font-medium text-gray-900">
                          {c.cobrador}
                          {c.rol && <span className="ml-1.5 text-[11px] text-gray-400">{ROL[c.rol] ?? c.rol}</span>}
                        </td>
                        {celdas(c)}
                      </tr>
                    ))}
                    <tr className="bg-gray-900 text-white"><td className="py-2 px-3 font-bold">TOTAL</td>{celdas(datos.total, true)}</tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Por día</CardTitle>
              <p className="no-print text-[11px] text-gray-500">Toca un día para ver su liquidación: cada cobro, quién lo cobró y la rendición de cada cobrador.</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  {encabezado('Fecha')}
                  <tbody className="divide-y divide-gray-50">
                    {datos.por_dia.length === 0 ? (
                      <tr><td colSpan={7} className="py-8 text-center text-gray-400">No hay cobros en este rango</td></tr>
                    ) : datos.por_dia.map((d) => (
                      <tr key={d.fecha} className="cursor-pointer hover:bg-yellow-50" data-fila-dia
                        onClick={() => setDiaAbierto(d.fecha)} title="Ver la liquidación de este día">
                        <td className="py-2 px-3 font-semibold text-blue-700 underline-offset-2 hover:underline">{formatDate(d.fecha)}</td>
                        {celdas(d)}
                      </tr>
                    ))}
                    {datos.por_dia.length > 0 && (
                      <tr className="bg-gray-900 text-white"><td className="py-2 px-3 font-bold">TOTAL</td>{celdas(datos.total, true)}</tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
      <LiquidacionDiaDialog fecha={diaAbierto} onClose={() => setDiaAbierto(null)} />
    </div>
  )
}
