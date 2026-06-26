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

interface Fila {
  vendedor_id: string
  vendedor_nombre: string
  familia_id: string
  familia_nombre: string
  cuota_monto: number
  vendido_monto: number
  comprobantes: number
  pct_cumplimiento: number | null
  diferencia: number
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

function CumplimientoInner() {
  const params = useSearchParams()
  const router = useRouter()
  const supabase = createClient()
  const ahora = new Date()
  const [anio, setAnio] = useState(parseInt(params.get('anio') ?? '') || ahora.getFullYear())
  const [mes, setMes] = useState(parseInt(params.get('mes') ?? '') || ahora.getMonth() + 1)
  const [filas, setFilas] = useState<Fila[]>([])
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState<'matriz' | 'vendedor' | 'familia'>('matriz')

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await (supabase.rpc as any)('cumplimiento_cuotas_mes', {
      p_anio: anio, p_mes: mes,
    })
    setFilas(((data?.filas ?? []) as Fila[]))
    setLoading(false)
  }, [supabase, anio, mes])

  useEffect(() => { cargar() }, [cargar])

  const vendedores = useMemo(() => {
    const m = new Map<string, string>()
    filas.forEach((f) => m.set(f.vendedor_id, f.vendedor_nombre))
    return Array.from(m.entries()).map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [filas])

  const familias = useMemo(() => {
    const m = new Map<string, string>()
    filas.forEach((f) => m.set(f.familia_id, f.familia_nombre))
    return Array.from(m.entries()).map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [filas])

  const cell = (vid: string, fid: string) => filas.find((f) => f.vendedor_id === vid && f.familia_id === fid)

  // KPIs globales
  const kpis = useMemo(() => {
    const cuota = filas.reduce((a, f) => a + Number(f.cuota_monto), 0)
    const vendido = filas.reduce((a, f) => a + Number(f.vendido_monto), 0)
    return {
      cuota,
      vendido,
      pct: cuota > 0 ? (vendido / cuota) * 100 : 0,
      diff: vendido - cuota,
    }
  }, [filas])

  // Resumen por vendedor
  const resumenVendedor = useMemo(() => {
    return vendedores.map((v) => {
      const fs = filas.filter((f) => f.vendedor_id === v.id)
      const cuota = fs.reduce((a, f) => a + Number(f.cuota_monto), 0)
      const vendido = fs.reduce((a, f) => a + Number(f.vendido_monto), 0)
      return { ...v, cuota, vendido, pct: cuota > 0 ? (vendido / cuota) * 100 : null }
    }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
  }, [vendedores, filas])

  // Resumen por familia
  const resumenFamilia = useMemo(() => {
    return familias.map((f) => {
      const fs = filas.filter((x) => x.familia_id === f.id)
      const cuota = fs.reduce((a, x) => a + Number(x.cuota_monto), 0)
      const vendido = fs.reduce((a, x) => a + Number(x.vendido_monto), 0)
      return { ...f, cuota, vendido, pct: cuota > 0 ? (vendido / cuota) * 100 : null }
    }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
  }, [familias, filas])

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
            Cuota objetivo vs vendido real · {MESES[mes-1]} {anio}
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
          <Label className="text-[10px] text-gray-500">Mes</Label>
          <select value={mes} onChange={(e) => setMes(parseInt(e.target.value))}
            className="block mt-1 h-9 px-2 text-sm border border-gray-300 rounded-md bg-white">
            {MESES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Año</Label>
          <Input type="number" value={anio} onChange={(e) => setAnio(parseInt(e.target.value) || ahora.getFullYear())}
            className="w-24 h-9 text-sm" min={2024} max={2100} />
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
            <p>{MESES[mes-1]} {anio}</p>
          </div>
        </div>
      </div>

      {/* KPIs globales */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs uppercase font-semibold text-blue-700">CUOTA TOTAL</p>
          <p className="text-xl font-bold text-blue-900">{formatCurrency(kpis.cuota)}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <p className="text-xs uppercase font-semibold text-emerald-700">VENDIDO REAL</p>
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
      </div>

      {/* Contenido según vista */}
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : kpis.cuota === 0 ? (
        <div className="text-center py-16 bg-white border border-amber-200 rounded-lg">
          <p className="text-amber-700 font-semibold">⚠ Sin cuotas asignadas para este mes</p>
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
                  const cuotaV = filas.filter((f) => f.vendedor_id === v.id).reduce((a, f) => a + Number(f.cuota_monto), 0)
                  const vendidoV = filas.filter((f) => f.vendedor_id === v.id).reduce((a, f) => a + Number(f.vendido_monto), 0)
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
