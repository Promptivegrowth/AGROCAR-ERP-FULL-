'use client'

import { useEffect, useState, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Target, TrendingUp, Printer } from 'lucide-react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'
import { rangoInicial, atajosRango, fechaCorta } from '@/lib/rango-reporte'

interface Fila {
  vendedor_id: string
  vendedor_nombre: string
  /** vendedor: tiene cuota. repartidor: su venta directa es venta adicional, sin cuota (Daniel, 06/11). */
  rol: 'vendedor' | 'repartidor'
  familia_id: string
  familia_nombre: string
  cuota_monto: number
  vendido_monto: number
  comprobantes: number
  pct_cumplimiento: number | null
  diferencia: number
}

function CumplimientoInner() {
  const params = useSearchParams()
  const router = useRouter()
  const supabase = createClient()
  const inicial = rangoInicial(params)
  const [desde, setDesde] = useState(inicial.desde)
  const [hasta, setHasta] = useState(inicial.hasta)
  const [filas, setFilas] = useState<Fila[]>([])
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState<'matriz' | 'vendedor' | 'familia'>('matriz')

  const cargar = useCallback(async () => {
    if (!desde || !hasta || hasta < desde) return
    setLoading(true)
    const { data } = await (supabase.rpc as any)('cumplimiento_cuotas_rango', {
      p_desde: desde, p_hasta: hasta,
    })
    setFilas(((data?.filas ?? []) as Fila[]))
    setLoading(false)
  }, [supabase, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  // Los vendedores (con cuota) y aparte los repartidores que vendieron en el rango.
  const vendedores = useMemo(() => {
    const m = new Map<string, string>()
    filas.filter((f) => f.rol !== 'repartidor').forEach((f) => m.set(f.vendedor_id, f.vendedor_nombre))
    return Array.from(m.entries()).map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [filas])
  const filasVend = useMemo(() => filas.filter((f) => f.rol !== 'repartidor'), [filas])
  const filasRep = useMemo(() => filas.filter((f) => f.rol === 'repartidor'), [filas])
  const repartidores = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; vendido: number; comprobantes: number }>()
    filasRep.forEach((f) => {
      const x = m.get(f.vendedor_id) ?? { id: f.vendedor_id, nombre: f.vendedor_nombre, vendido: 0, comprobantes: 0 }
      x.vendido += Number(f.vendido_monto)
      m.set(f.vendedor_id, x)
    })
    return Array.from(m.values()).filter((x) => Math.abs(x.vendido) > 0.004).sort((a, b) => b.vendido - a.vendido)
  }, [filasRep])

  const familias = useMemo(() => {
    const m = new Map<string, string>()
    filas.forEach((f) => m.set(f.familia_id, f.familia_nombre))
    return Array.from(m.entries()).map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [filas])

  const cell = (vid: string, fid: string) => filas.find((f) => f.vendedor_id === vid && f.familia_id === fid)

  // KPIs globales: el cumplimiento es de los vendedores; la venta de los
  // repartidores se suma aparte como venta adicional.
  const kpis = useMemo(() => {
    const cuota = filasVend.reduce((a, f) => a + Number(f.cuota_monto), 0)
    const vendido = filasVend.reduce((a, f) => a + Number(f.vendido_monto), 0)
    const adicional = filasRep.reduce((a, f) => a + Number(f.vendido_monto), 0)
    return {
      cuota,
      vendido,
      adicional,
      totalVenta: vendido + adicional,
      pct: cuota > 0 ? (vendido / cuota) * 100 : 0,
      diff: vendido - cuota,
    }
  }, [filasVend, filasRep])

  // Resumen por vendedor
  const resumenVendedor = useMemo(() => {
    return vendedores.map((v) => {
      const fs = filasVend.filter((f) => f.vendedor_id === v.id)
      const cuota = fs.reduce((a, f) => a + Number(f.cuota_monto), 0)
      const vendido = fs.reduce((a, f) => a + Number(f.vendido_monto), 0)
      return { ...v, cuota, vendido, pct: cuota > 0 ? (vendido / cuota) * 100 : null }
    }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
  }, [vendedores, filasVend])

  // Resumen por familia
  const resumenFamilia = useMemo(() => {
    return familias.map((f) => {
      const fs = filasVend.filter((x) => x.familia_id === f.id)
      const cuota = fs.reduce((a, x) => a + Number(x.cuota_monto), 0)
      const vendido = fs.reduce((a, x) => a + Number(x.vendido_monto), 0)
      const adicional = filasRep.filter((x) => x.familia_id === f.id).reduce((a, x) => a + Number(x.vendido_monto), 0)
      return { ...f, cuota, vendido, adicional, pct: cuota > 0 ? (vendido / cuota) * 100 : null }
    }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
  }, [familias, filasVend, filasRep])
  const adicionalDe = (rid: string, fid: string) =>
    filasRep.filter((f) => f.vendedor_id === rid && f.familia_id === fid).reduce((a, f) => a + Number(f.vendido_monto), 0)

  const colorPct = (pct: number | null) => {
    if (pct === null) return 'text-gray-400'
    if (pct >= 100) return 'text-green-700 font-bold'
    if (pct >= 80) return 'text-emerald-600 font-semibold'
    if (pct >= 50) return 'text-amber-600'
    return 'text-red-600'
  }
  const bgPct = (pct: number | null) => {
    if (pct === null) return ''
    if (pct >= 100) return 'bg-green-100'
    if (pct >= 80) return 'bg-emerald-50'
    if (pct >= 50) return 'bg-amber-50'
    return 'bg-red-50'
  }

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{`@media print {
        @page { size: A4 landscape; margin: 10mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
        table { font-size: 9pt !important; }
      }`}</style>

      <div className="flex items-center gap-3 no-print">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Target className="w-6 h-6 text-blue-600" />
            Cumplimiento de Cuotas
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cuota objetivo vs vendido real · del {fechaCorta(desde)} al {fechaCorta(hasta)} · con la venta adicional de los repartidores
          </p>
        </div>
        <Link href={`/vendedores/cuotas`}
          className="text-xs px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-md">
          ⚙ Asignar cuotas
        </Link>
        <button onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]">
          <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3 no-print">
        <div>
          <Label className="text-[10px] text-gray-500">Desde</Label>
          <Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="w-40 h-9 text-sm mt-1" aria-label="Desde" />
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Hasta</Label>
          <Input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className="w-40 h-9 text-sm mt-1" aria-label="Hasta" />
        </div>
        <div className="flex gap-1 h-9 items-center">
          {atajosRango().map((a) => (
            <button key={a.etiqueta} type="button" onClick={() => { setDesde(a.desde); setHasta(a.hasta) }}
              className="text-[11px] px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">{a.etiqueta}</button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
          {(['matriz','vendedor','familia'] as const).map((v) => (
            <button key={v} onClick={() => setVista(v)}
              className={`text-xs px-3 py-1.5 rounded-md font-semibold ${
                vista === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
              }`}>
              {v === 'matriz' ? 'Matriz' : v === 'vendedor' ? 'Por vendedor' : 'Por familia'}
            </button>
          ))}
        </div>
      </div>

      {/* Header impresión */}
      <div className="hidden print:block pb-2 border-b-2 border-black">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-base">{EMPRESA.razon_social} · RUC {EMPRESA.ruc}</p>
            <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 14 }}>{EMPRESA.slogan}</p>
          </div>
          <div className="text-right text-xs">
            <p className="font-bold">CUMPLIMIENTO DE CUOTAS</p>
            <p>Del {fechaCorta(desde)} al {fechaCorta(hasta)}</p>
          </div>
        </div>
      </div>

      {/* KPIs globales */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs uppercase font-semibold text-blue-700">CUOTA TOTAL</p>
          <p className="text-xl font-bold text-blue-900">{formatCurrency(kpis.cuota)}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <p className="text-xs uppercase font-semibold text-emerald-700">VENDIDO VENDEDORES</p>
          <p className="text-xl font-bold text-emerald-900">{formatCurrency(kpis.vendido)}</p>
        </div>
        <div className={`rounded-lg p-3 border-2 ${kpis.pct >= 100 ? 'bg-green-50 border-green-300' : kpis.pct >= 80 ? 'bg-amber-50 border-amber-300' : 'bg-red-50 border-red-300'}`}>
          <p className="text-xs uppercase font-semibold flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> % CUMPLIMIENTO
          </p>
          <p className={`text-xl font-bold ${colorPct(kpis.pct)}`}>{kpis.pct.toFixed(1)}%</p>
        </div>
        <div className={`rounded-lg p-3 border ${kpis.diff >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <p className="text-xs uppercase font-semibold">{kpis.diff >= 0 ? 'EXCEDENTE' : 'FALTANTE'}</p>
          <p className={`text-xl font-bold ${kpis.diff >= 0 ? 'text-emerald-900' : 'text-red-900'}`}>
            {formatCurrency(Math.abs(kpis.diff))}
          </p>
        </div>
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-3" data-venta-adicional>
          <p className="text-xs uppercase font-semibold text-violet-700">VENTA ADICIONAL</p>
          <p className="text-xl font-bold text-violet-900">{formatCurrency(kpis.adicional)}</p>
          <p className="text-[10px] text-violet-700">venta directa de repartidores</p>
        </div>
        <div className="bg-gray-900 text-white rounded-lg p-3" data-venta-total>
          <p className="text-xs uppercase font-semibold text-gray-300">VENTA TOTAL</p>
          <p className="text-xl font-bold">{formatCurrency(kpis.totalVenta)}</p>
          <p className="text-[10px] text-gray-400">vendedores + adicional</p>
        </div>
      </div>

      {/* Contenido según vista */}
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : kpis.cuota === 0 && repartidores.length === 0 ? (
        <div className="text-center py-16 bg-white border border-amber-200 rounded-lg">
          <p className="text-amber-700 font-semibold">⚠ Sin cuotas asignadas para este rango</p>
          <Link href="/vendedores/cuotas" className="text-blue-700 underline text-sm mt-2 inline-block">
            → Asigna cuotas aquí
          </Link>
        </div>
      ) : vista === 'matriz' ? (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left p-2 font-semibold border-b border-r sticky left-0 bg-gray-50 z-10 min-w-[160px]">
                    Vendedor / Familia
                  </th>
                  {familias.map((f) => (
                    <th key={f.id} className="text-center p-2 font-semibold border-b min-w-[100px]">{f.nombre}</th>
                  ))}
                  <th className="text-center p-2 font-bold border-b bg-blue-50 min-w-[100px]">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {vendedores.map((v) => {
                  const cuotaV = filasVend.filter((f) => f.vendedor_id === v.id).reduce((a, f) => a + Number(f.cuota_monto), 0)
                  const vendidoV = filasVend.filter((f) => f.vendedor_id === v.id).reduce((a, f) => a + Number(f.vendido_monto), 0)
                  const pctV = cuotaV > 0 ? (vendidoV / cuotaV) * 100 : null
                  return (
                    <tr key={v.id} className="border-b border-gray-100">
                      <td className="p-2 font-semibold sticky left-0 bg-white border-r z-10">{v.nombre}</td>
                      {familias.map((f) => {
                        const c = cell(v.id, f.id)
                        if (!c || Number(c.cuota_monto) === 0) {
                          return <td key={f.id} className="p-1 text-center text-gray-300 text-[10px]">—</td>
                        }
                        return (
                          <td key={f.id} className={`p-1 text-center ${bgPct(c.pct_cumplimiento)}`}>
                            <div className="text-[9px] text-gray-600">{formatCurrency(c.vendido_monto)} / {formatCurrency(c.cuota_monto)}</div>
                            <div className={`text-xs ${colorPct(c.pct_cumplimiento)}`}>{c.pct_cumplimiento?.toFixed(0) ?? 0}%</div>
                          </td>
                        )
                      })}
                      <td className={`p-2 text-center ${bgPct(pctV)}`}>
                        <div className="text-[10px]">{formatCurrency(vendidoV)} / {formatCurrency(cuotaV)}</div>
                        <div className={`text-sm ${colorPct(pctV)}`}>{pctV !== null ? pctV.toFixed(0) + '%' : '—'}</div>
                      </td>
                    </tr>
                  )
                })}
                {repartidores.length > 0 && (
                  <>
                    <tr className="bg-violet-50 border-y border-violet-200">
                      <td colSpan={familias.length + 2} className="p-2 text-[11px] font-bold uppercase text-violet-800 sticky left-0">
                        Venta adicional · venta directa de repartidores (sin cuota)
                      </td>
                    </tr>
                    {repartidores.map((rp) => (
                      <tr key={rp.id} className="border-b border-gray-100" data-repartidor={rp.nombre}>
                        <td className="p-2 font-semibold sticky left-0 bg-white border-r z-10">
                          {rp.nombre}<span className="ml-1 text-[9px] font-semibold uppercase text-violet-600">repartidor</span>
                        </td>
                        {familias.map((f) => {
                          const v = adicionalDe(rp.id, f.id)
                          return (
                            <td key={f.id} className="p-1 text-center text-[10px] text-violet-900">
                              {Math.abs(v) > 0.004 ? formatCurrency(v) : <span className="text-gray-300">—</span>}
                            </td>
                          )
                        })}
                        <td className="p-2 text-center font-semibold text-violet-900 bg-violet-50">{formatCurrency(rp.vendido)}</td>
                      </tr>
                    ))}
                  </>
                )}
                <tr className="border-t-2 border-gray-400 bg-gray-50 font-semibold">
                  <td className="p-2 sticky left-0 bg-gray-50 border-r z-10">Vendedores</td>
                  {familias.map((f) => {
                    const v = filasVend.filter((x) => x.familia_id === f.id).reduce((a, x) => a + Number(x.vendido_monto), 0)
                    return <td key={f.id} className="p-1 text-center text-[10px]">{formatCurrency(v)}</td>
                  })}
                  <td className="p-2 text-center">{formatCurrency(kpis.vendido)}</td>
                </tr>
                {repartidores.length > 0 && (
                  <tr className="bg-violet-50 font-semibold text-violet-900">
                    <td className="p-2 sticky left-0 bg-violet-50 border-r z-10">Venta adicional</td>
                    {familias.map((f) => {
                      const v = filasRep.filter((x) => x.familia_id === f.id).reduce((a, x) => a + Number(x.vendido_monto), 0)
                      return <td key={f.id} className="p-1 text-center text-[10px]">{Math.abs(v) > 0.004 ? formatCurrency(v) : '—'}</td>
                    })}
                    <td className="p-2 text-center">{formatCurrency(kpis.adicional)}</td>
                  </tr>
                )}
                <tr className="bg-gray-900 text-white font-bold">
                  <td className="p-2 sticky left-0 bg-gray-900 border-r z-10">VENTA TOTAL</td>
                  {familias.map((f) => {
                    const v = filas.filter((x) => x.familia_id === f.id).reduce((a, x) => a + Number(x.vendido_monto), 0)
                    return <td key={f.id} className="p-1 text-center text-[10px]">{formatCurrency(v)}</td>
                  })}
                  <td className="p-2 text-center" data-total-matriz>{formatCurrency(kpis.totalVenta)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : vista === 'vendedor' ? (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold w-8">#</th>
                <th className="text-left p-2 font-semibold">Vendedor</th>
                <th className="text-right p-2 font-semibold w-32">Cuota</th>
                <th className="text-right p-2 font-semibold w-32">Vendido</th>
                <th className="text-right p-2 font-semibold w-32">Diferencia</th>
                <th className="text-right p-2 font-semibold w-24">% Cump.</th>
              </tr>
            </thead>
            <tbody>
              {resumenVendedor.map((v, i) => (
                <tr key={v.id} className={`border-b border-gray-100 ${bgPct(v.pct)}`}>
                  <td className="p-2 text-gray-400 font-mono">{i+1}</td>
                  <td className="p-2 font-semibold">{v.nombre}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(v.cuota)}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(v.vendido)}</td>
                  <td className={`p-2 text-right font-mono ${v.vendido - v.cuota >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatCurrency(v.vendido - v.cuota)}
                  </td>
                  <td className={`p-2 text-right font-bold text-lg ${colorPct(v.pct)}`}>
                    {v.pct !== null ? v.pct.toFixed(0) + '%' : '—'}
                  </td>
                </tr>
              ))}
              {repartidores.map((rp) => (
                <tr key={rp.id} className="border-b border-gray-100 bg-violet-50/60">
                  <td className="p-2 text-gray-400 font-mono">·</td>
                  <td className="p-2 font-semibold">{rp.nombre} <span className="text-[10px] font-semibold uppercase text-violet-600">repartidor · venta adicional</span></td>
                  <td className="p-2 text-right font-mono text-gray-400">—</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(rp.vendido)}</td>
                  <td className="p-2 text-right font-mono text-gray-400">—</td>
                  <td className="p-2 text-right text-xs text-violet-700">sin cuota</td>
                </tr>
              ))}
              <tr className="bg-gray-900 text-white font-bold">
                <td className="p-2" />
                <td className="p-2">VENTA TOTAL (vendedores + adicional)</td>
                <td className="p-2 text-right font-mono">{formatCurrency(kpis.cuota)}</td>
                <td className="p-2 text-right font-mono">{formatCurrency(kpis.totalVenta)}</td>
                <td className="p-2" />
                <td className="p-2" />
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold w-8">#</th>
                <th className="text-left p-2 font-semibold">Familia</th>
                <th className="text-right p-2 font-semibold w-32">Cuota</th>
                <th className="text-right p-2 font-semibold w-32">Vendido</th>
                <th className="text-right p-2 font-semibold w-32">Diferencia</th>
                <th className="text-right p-2 font-semibold w-24">% Cump.</th>
                <th className="text-right p-2 font-semibold w-32 text-violet-700">Venta adicional</th>
              </tr>
            </thead>
            <tbody>
              {resumenFamilia.map((f, i) => (
                <tr key={f.id} className={`border-b border-gray-100 ${bgPct(f.pct)}`}>
                  <td className="p-2 text-gray-400 font-mono">{i+1}</td>
                  <td className="p-2 font-semibold">{f.nombre}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(f.cuota)}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(f.vendido)}</td>
                  <td className={`p-2 text-right font-mono ${f.vendido - f.cuota >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatCurrency(f.vendido - f.cuota)}
                  </td>
                  <td className={`p-2 text-right font-bold text-lg ${colorPct(f.pct)}`}>
                    {f.pct !== null ? f.pct.toFixed(0) + '%' : '—'}
                  </td>
                  <td className="p-2 text-right font-mono text-violet-800">{Math.abs(f.adicional) > 0.004 ? formatCurrency(f.adicional) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function CumplimientoCuotasPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}>
      <CumplimientoInner />
    </Suspense>
  )
}
