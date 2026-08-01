'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Target, TrendingUp, ChevronDown, ChevronRight, Package } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

export default function MisCuotasPage() {
  const router = useRouter()
  const supabase = createClient()
  const ahora = new Date()
  const [anio, setAnio] = useState(ahora.getFullYear())
  const [mes, setMes] = useState(ahora.getMonth() + 1)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())

  const toggle = (key: string) => setAbiertas((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data: d } = await (supabase.rpc as any)('pwa_mis_cuotas', { p_anio: anio, p_mes: mes })
    setData(d)
    setLoading(false)
  }, [supabase, anio, mes])

  useEffect(() => { cargar() }, [cargar])

  const miPct = data && Number(data.mi_cuota_total) > 0
    ? (Number(data.mi_vendido_total) / Number(data.mi_cuota_total)) * 100
    : null
  const colorPct = (pct: number | null) =>
    pct === null ? 'text-gray-400'
    : pct >= 100 ? 'text-green-600'
    : pct >= 80 ? 'text-emerald-600'
    : pct >= 50 ? 'text-amber-600'
    : 'text-red-600'

  const barColor = (pct: number | null) =>
    pct === null ? 'bg-gray-300'
    : pct >= 100 ? 'bg-green-500'
    : pct >= 80 ? 'bg-emerald-500'
    : pct >= 50 ? 'bg-amber-500'
    : 'bg-red-500'

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-black text-white px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1.5 hover:bg-white/10 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-lg flex items-center gap-2">
              <Target className="w-5 h-5 text-[#FBE600]" />
              Mis Cuotas del Mes
            </h1>
            <p className="text-xs text-gray-400">Tu meta por familia y por producto</p>
          </div>
        </div>
        {/* Selector período */}
        <div className="flex gap-2 mt-3">
          <select value={mes} onChange={(e) => setMes(parseInt(e.target.value))}
            className="flex-1 h-9 px-2 text-sm rounded-md bg-white/10 border border-white/20 text-white">
            {MESES.map((m, i) => <option key={i + 1} value={i + 1} className="text-black">{m}</option>)}
          </select>
          <select value={anio} onChange={(e) => setAnio(parseInt(e.target.value))}
            className="w-24 h-9 px-2 text-sm rounded-md bg-white/10 border border-white/20 text-white">
            {[anio + 1, anio, anio - 1].map((a) => <option key={a} value={a} className="text-black">{a}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-gray-400" />
        </div>
      ) : !data ? (
        <p className="text-center py-16 text-gray-400 text-sm">Sin datos</p>
      ) : (
        <div className="p-4 space-y-4">
          {/* MI RESUMEN */}
          <div className="bg-[#FBE600] rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase text-gray-800 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" /> MI AVANCE DEL MES
              </p>
              {miPct !== null && (
                <span className="text-2xl font-black text-gray-900">{miPct.toFixed(0)}%</span>
              )}
            </div>
            <div className="flex justify-between mt-2 text-sm text-gray-800">
              <span>Vendido: <strong>{formatCurrency(data.mi_vendido_total)}</strong></span>
              <span>Meta: <strong>{formatCurrency(data.mi_cuota_total)}</strong></span>
            </div>
            {miPct !== null && (
              <div className="w-full bg-black/10 rounded-full h-2.5 mt-2 overflow-hidden">
                <div className="bg-gray-900 h-full transition-all" style={{ width: `${Math.min(miPct, 100)}%` }}></div>
              </div>
            )}
            {data.mi_cuota_total === 0 && (
              <p className="text-xs text-gray-700 mt-1">Aún no te asignaron cuota este mes.</p>
            )}
          </div>

          {/* POR FAMILIA */}
          <div>
            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Por familia de producto</p>
            {(data.familias ?? []).length === 0 ? (
              <div className="bg-white rounded-xl p-6 text-center text-gray-400 text-sm">
                Sin cuotas ni ventas este mes
              </div>
            ) : (
              <div className="space-y-2">
                {(data.familias as any[]).map((f) => {
                  const productos = (f.productos ?? []) as any[]
                  const abierta = abiertas.has(f.familia)
                  return (
                    <div key={f.familia} className="bg-white rounded-xl shadow-sm overflow-hidden">
                      <button type="button"
                        onClick={() => productos.length > 0 && toggle(f.familia)}
                        className="w-full text-left p-3 active:bg-gray-50">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-sm text-gray-900 flex items-center gap-1 flex-1">
                            {productos.length > 0 && (
                              abierta ? <ChevronDown className="w-4 h-4 text-gray-400" />
                                      : <ChevronRight className="w-4 h-4 text-gray-400" />
                            )}
                            {f.familia}
                          </p>
                          <span className={`font-black text-lg ${colorPct(f.pct)}`}>
                            {f.pct !== null ? `${Number(f.pct).toFixed(0)}%` : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-500 mt-0.5">
                          <span>Vendido: {formatCurrency(f.vendido)}</span>
                          <span>{f.cuota > 0 ? `Meta: ${formatCurrency(f.cuota)}` : 'Sin meta asignada'}</span>
                        </div>
                        {f.pct !== null && (
                          <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1.5 overflow-hidden">
                            <div className={`${barColor(f.pct)} h-full`} style={{ width: `${Math.min(Number(f.pct), 100)}%` }}></div>
                          </div>
                        )}
                        {productos.length > 0 && !abierta && (
                          <p className="text-[10px] text-blue-600 font-semibold mt-1.5 flex items-center gap-1">
                            <Package className="w-3 h-3" /> Ver mis {productos.length} productos con meta
                          </p>
                        )}
                      </button>

                      {abierta && productos.length > 0 && (
                        <div className="border-t border-gray-100 bg-gray-50/60 divide-y divide-gray-100">
                          {productos.map((p: any, i: number) => (
                            <div key={`${p.codigo}-${i}`} className="px-3 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[11px] font-semibold text-gray-800 leading-tight flex-1">
                                  {p.descripcion}
                                </p>
                                <span className={`text-xs font-bold shrink-0 ${colorPct(p.pct_valor)}`}>
                                  {p.pct_valor !== null ? `${Number(p.pct_valor).toFixed(0)}%` : '—'}
                                </span>
                              </div>
                              <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                                <span>
                                  Cant: <strong className="text-gray-700">{Number(p.vendido_cant).toLocaleString('es-PE')}</strong>
                                  {Number(p.cuota_cant) > 0 && ` / ${Number(p.cuota_cant).toLocaleString('es-PE')}`}
                                </span>
                                <span>
                                  {formatCurrency(p.vendido_valor)}
                                  {Number(p.cuota_valor) > 0 && ` / ${formatCurrency(p.cuota_valor)}`}
                                </span>
                              </div>
                              {p.pct_valor !== null && (
                                <div className="w-full bg-gray-200 rounded-full h-1 mt-1 overflow-hidden">
                                  <div className={`${barColor(p.pct_valor)} h-full`}
                                    style={{ width: `${Math.min(Number(p.pct_valor), 100)}%` }}></div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <p className="text-[10px] text-gray-400 text-center">
            Vendido = subtotal sin IGV de tus comprobantes no anulados del mes.
          </p>
        </div>
      )}
    </div>
  )
}
