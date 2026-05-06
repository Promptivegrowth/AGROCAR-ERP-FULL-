'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, ComposedChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Zap, ChevronRight, ChevronDown, TrendingUp, History } from 'lucide-react'

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const COLORS_PIE = ['#FBE600', '#0A0A0A', '#94a3b8', '#1e40af', '#16a34a', '#dc2626', '#7c3aed']
// Margen fallback cuando los productos aún no tienen costo (BD recién poblada)
const MARGEN_FALLBACK = 0.22

export default function VentasTab() {
  const supabase = createClient()
  const now = new Date()
  const [anio, setAnio] = useState<number>(now.getFullYear())
  const [familiaSel, setFamiliaSel] = useState<string>('todas')
  const [loading, setLoading] = useState(true)
  const [pedidos, setPedidos] = useState<any[]>([])
  const [pedidosAll, setPedidosAll] = useState<any[]>([])
  const [familias, setFamilias] = useState<any[]>([])

  useEffect(() => {
    ;(async () => {
      const { data: f } = await supabase.from('familias').select('id, nombre').eq('activo', true).order('nombre')
      setFamilias(f ?? [])
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [{ data: p }, { data: pAll }] = await Promise.all([
        (supabase as any)
          .from('pedidos')
          .select(`
            id, fecha_pedido, total, subtotal, estado,
            pedidos_items(cantidad, subtotal, costo_unitario, utilidad, productos(id, codigo, nombre, descripcion, costo_promedio, familias(id, nombre)))
          `)
          .gte('fecha_pedido', `${anio}-01-01`)
          .lte('fecha_pedido', `${anio}-12-31`)
          .in('estado', ['facturado','despachado','entregado']),
        (supabase as any)
          .from('pedidos')
          .select('fecha_pedido, total, subtotal, pedidos_items(cantidad, subtotal, utilidad)')
          .in('estado', ['facturado','despachado','entregado']),
      ])
      setPedidos(p ?? [])
      setPedidosAll(pAll ?? [])
      setLoading(false)
    })()
  }, [anio])

  // ─── Utilidad real con fallback ────────────────────────────────────────────
  // Por línea: si tiene utilidad guardada (trigger), usar esa. Si no, fallback 22% del subtotal.
  const utilidadDeLinea = (it: any) => {
    if (it.utilidad != null && Number(it.utilidad) !== 0) return Number(it.utilidad)
    return Number(it.subtotal ?? 0) * MARGEN_FALLBACK
  }
  const ventaDePedido = (p: any) => (p.pedidos_items ?? []).reduce((a: number, it: any) => a + Number(it.subtotal ?? 0), 0)
  const utilidadDePedido = (p: any) => (p.pedidos_items ?? []).reduce((a: number, it: any) => a + utilidadDeLinea(it), 0)

  // ─── Filtro por familia ────────────────────────────────────────────────────
  const pedidosFiltrados = useMemo(() => {
    if (familiaSel === 'todas') return pedidos
    return pedidos.map((p: any) => ({
      ...p,
      pedidos_items: (p.pedidos_items ?? []).filter((it: any) => it.productos?.familias?.id === familiaSel),
    })).filter((p: any) => p.pedidos_items.length > 0)
  }, [pedidos, familiaSel])

  const totalVentas = pedidosFiltrados.reduce((a, p) => a + ventaDePedido(p), 0)
  const totalUtilidad = pedidosFiltrados.reduce((a, p) => a + utilidadDePedido(p), 0)
  const margenPct = totalVentas > 0 ? (totalUtilidad / totalVentas) * 100 : 0

  // ─── Predictivo fin de año ─────────────────────────────────────────────────
  const totalDias = now.getFullYear() === anio
    ? Math.max(1, Math.ceil((now.getTime() - new Date(anio, 0, 1).getTime()) / 86400000))
    : 365
  const proyeccionAnual = totalDias > 0 ? (totalVentas / totalDias) * 365 : 0

  // ─── Trimestres ────────────────────────────────────────────────────────────
  const trimestres = useMemo(() => {
    const res = [
      { label: 'TRIM.1', ventas: 0, utilidad: 0 },
      { label: 'TRIM.2', ventas: 0, utilidad: 0 },
      { label: 'TRIM.3', ventas: 0, utilidad: 0 },
      { label: 'TRIM.4', ventas: 0, utilidad: 0 },
    ]
    pedidosFiltrados.forEach((p: any) => {
      const m = new Date(p.fecha_pedido + 'T12:00:00').getMonth()
      const q = Math.floor(m / 3)
      res[q].ventas += ventaDePedido(p)
      res[q].utilidad += utilidadDePedido(p)
    })
    return res.map((r) => ({
      ...r,
      ventas: Math.round(r.ventas),
      utilidad: Math.round(r.utilidad),
      margen: r.ventas > 0 ? Math.round((r.utilidad / r.ventas) * 100) : 0,
    }))
  }, [pedidosFiltrados])

  // ─── Donut por familia ─────────────────────────────────────────────────────
  const porFamilia = useMemo(() => {
    const map = new Map<string, number>()
    pedidosFiltrados.forEach((p: any) => {
      ;(p.pedidos_items ?? []).forEach((it: any) => {
        const fam = it.productos?.familias?.nombre ?? 'Sin familia'
        map.set(fam, (map.get(fam) ?? 0) + Number(it.subtotal ?? 0))
      })
    })
    return Array.from(map.entries())
      .map(([nombre, total]) => ({ nombre, total: Math.round(total) }))
      .sort((a, b) => b.total - a.total)
  }, [pedidosFiltrados])

  // ─── Tabla familia → productos (expandible) con utilidad real ──────────────
  const tablaFamilia = useMemo(() => {
    const map = new Map<string, { familia: string; ventas: number; utilidad: number; productos: Map<string, { ventas: number; utilidad: number }> }>()
    pedidosFiltrados.forEach((p: any) => {
      ;(p.pedidos_items ?? []).forEach((it: any) => {
        const fam = it.productos?.familias?.nombre ?? 'Sin familia'
        const prev = map.get(fam) ?? { familia: fam, ventas: 0, utilidad: 0, productos: new Map() }
        const v = Number(it.subtotal ?? 0)
        const u = utilidadDeLinea(it)
        prev.ventas += v
        prev.utilidad += u
        const pn = it.productos?.descripcion?.trim() || it.productos?.nombre || '—'
        const pp = prev.productos.get(pn) ?? { ventas: 0, utilidad: 0 }
        pp.ventas += v
        pp.utilidad += u
        prev.productos.set(pn, pp)
        map.set(fam, prev)
      })
    })
    return Array.from(map.values()).map((r) => ({
      familia: r.familia,
      ventas: Math.round(r.ventas),
      utilidad: Math.round(r.utilidad),
      margen: r.ventas > 0 ? Math.round((r.utilidad / r.ventas) * 100) : 0,
      productos: Array.from(r.productos.entries())
        .map(([nombre, v]) => ({
          nombre,
          ventas: Math.round(v.ventas),
          utilidad: Math.round(v.utilidad),
          margen: v.ventas > 0 ? Math.round((v.utilidad / v.ventas) * 100) : 0,
        }))
        .sort((a, b) => b.ventas - a.ventas),
    })).sort((a, b) => b.ventas - a.ventas)
  }, [pedidosFiltrados])

  const maxVentaFamilia = Math.max(1, ...tablaFamilia.map((f) => f.ventas))
  const maxUtilidadFamilia = Math.max(1, ...tablaFamilia.map((f) => f.utilidad))

  // ─── Comparativa anual + ventas por año (línea) ────────────────────────────
  const comparativaAnual = useMemo(() => {
    const map = new Map<number, { ventas: number; utilidad: number }>()
    pedidosAll.forEach((p: any) => {
      const y = new Date(p.fecha_pedido + 'T12:00:00').getFullYear()
      const prev = map.get(y) ?? { ventas: 0, utilidad: 0 }
      prev.ventas += Number(p.total ?? 0)
      prev.utilidad += (p.pedidos_items ?? []).reduce((a: number, it: any) => a + utilidadDeLinea(it), 0)
      map.set(y, prev)
    })
    return Array.from(map.entries())
      .map(([anio, v]) => ({
        anio,
        ventas: Math.round(v.ventas),
        utilidad: Math.round(v.utilidad),
        margen: v.ventas > 0 ? Math.round((v.utilidad / v.ventas) * 100) : 0,
      }))
      .sort((a, b) => a.anio - b.anio)
  }, [pedidosAll])

  // ─── Histórico mes/año con barras de progreso ──────────────────────────────
  const historico = useMemo(() => {
    const map = new Map<string, { anio: number; mes: number; ventas: number; utilidad: number }>()
    pedidosAll.forEach((p: any) => {
      const d = new Date(p.fecha_pedido + 'T12:00:00')
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const prev = map.get(key) ?? { anio: d.getFullYear(), mes: d.getMonth(), ventas: 0, utilidad: 0 }
      prev.ventas += Number(p.total ?? 0)
      prev.utilidad += (p.pedidos_items ?? []).reduce((a: number, it: any) => a + utilidadDeLinea(it), 0)
      map.set(key, prev)
    })
    return Array.from(map.values())
      .map((r) => ({
        ...r,
        ventas: Math.round(r.ventas),
        utilidad: Math.round(r.utilidad),
        margenPct: r.ventas > 0 ? Math.round((r.utilidad / r.ventas) * 100) : 0,
      }))
      .sort((a, b) => b.anio - a.anio || b.mes - a.mes)
      .slice(0, 18)
  }, [pedidosAll])

  const maxVentaMes = Math.max(1, ...historico.map((h) => h.ventas))
  const maxUtilidadMes = Math.max(1, ...historico.map((h) => h.utilidad))

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="bg-slate-800 text-white rounded-xl p-3">
        <p className="text-[10px] uppercase tracking-widest text-center text-slate-400 mb-2">Filtros</p>
        <div className="grid grid-cols-2 gap-2">
          <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
            <SelectTrigger className="h-9 bg-white text-gray-900 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={familiaSel} onValueChange={setFamiliaSel}>
            <SelectTrigger className="h-9 bg-white text-gray-900 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las familias</SelectItem>
              {familias.map((f) => <SelectItem key={f.id} value={f.id}>{f.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 text-amber-500 animate-spin" /></div>
      ) : (
        <Tabs defaultValue="actual" className="space-y-4">
          <TabsList className="bg-gray-100 p-1 rounded-xl">
            <TabsTrigger value="actual" className="rounded-lg text-xs gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <TrendingUp className="w-3.5 h-3.5" /> Vista Anual ({anio})
            </TabsTrigger>
            <TabsTrigger value="historico" className="rounded-lg text-xs gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <History className="w-3.5 h-3.5" /> Ventas Históricas
            </TabsTrigger>
          </TabsList>

          {/* ────────────── TAB VISTA ANUAL ────────────── */}
          <TabsContent value="actual" className="space-y-4">
            {/* 3 KPI Trimestres grandes */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <KpiVenta titulo={`TOTAL VENTAS: ${formatCurrency(totalVentas)}`} data={trimestres} dataKey="ventas" color="#1e40af" headerClass="bg-slate-800 text-white" />
              <KpiVenta titulo={`TOTAL UTILIDAD: ${formatCurrency(totalUtilidad)}`} data={trimestres} dataKey="utilidad" color="#FBE600" headerClass="bg-[#FBE600] text-gray-900" />
              <KpiVenta titulo={`MARGEN UTILIDAD: ${margenPct.toFixed(1)}%`} data={trimestres} dataKey="margen" color="#0A0A0A" headerClass="bg-gray-200 text-gray-900" esPct />
            </div>

            {/* Predictivo */}
            <Card className="border-amber-200 bg-gradient-to-br from-yellow-50 to-amber-100">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-[#FBE600] flex items-center justify-center shrink-0">
                  <Zap className="w-6 h-6 text-gray-900" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] uppercase tracking-wide text-amber-900 font-bold">Proyección Fin de Año {anio}</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(proyeccionAnual)}</p>
                  <p className="text-xs text-gray-700">
                    Basado en el ritmo diario actual · Utilidad estimada {formatCurrency(proyeccionAnual * (margenPct / 100 || MARGEN_FALLBACK))}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Donut + tabla familia expandible */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="border-gray-200 shadow-sm lg:col-span-1">
                <CardHeader className="pb-1">
                  <CardTitle className="bg-[#FBE600] inline-block px-4 py-1 rounded font-bold text-gray-900 text-sm">
                    Ventas por familia
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {porFamilia.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-12">Sin ventas en el período</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie data={porFamilia} dataKey="total" nameKey="nombre" cx="50%" cy="50%" innerRadius={55} outerRadius={90} label={(e: any) => `${(e.percent * 100).toFixed(0)}%`}>
                          {porFamilia.map((_, idx) => <Cell key={idx} fill={COLORS_PIE[idx % COLORS_PIE.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="border-gray-200 shadow-sm lg:col-span-2">
                <CardHeader className="pb-1">
                  <CardTitle className="bg-[#FBE600] inline-block px-4 py-1 rounded font-bold text-gray-900 text-sm">
                    Totales por familia y productos
                  </CardTitle>
                  <p className="text-[11px] text-gray-500 mt-1">Click sobre una familia para ver el desglose por producto</p>
                </CardHeader>
                <CardContent className="p-0">
                  <TablaFamilia data={tablaFamilia} maxVenta={maxVentaFamilia} maxUtilidad={maxUtilidadFamilia} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ────────────── TAB VENTAS HISTÓRICAS ────────────── */}
          <TabsContent value="historico" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="border-gray-200 shadow-sm">
                <CardHeader className="pb-1 bg-black rounded-t-xl text-white">
                  <CardTitle className="text-sm font-bold">Comparativa anual: ventas x margen utilidad</CardTitle>
                </CardHeader>
                <CardContent>
                  {comparativaAnual.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-12">Sin datos históricos aún</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={comparativaAnual}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="anio" fontSize={11} />
                        <YAxis yAxisId="left" tickFormatter={(v) => `S/ ${(v/1000).toFixed(0)}k`} fontSize={10} />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} fontSize={10} />
                        <Tooltip formatter={(v: any, name: any) => name === 'margen' ? `${v}%` : formatCurrency(Number(v))} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="left" dataKey="ventas" fill="#FBE600" name="Ventas" radius={[4,4,0,0]} />
                        <Line yAxisId="right" type="monotone" dataKey="margen" stroke="#0A0A0A" strokeWidth={2} name="Margen %" dot={{ r: 4 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="border-gray-200 shadow-sm">
                <CardHeader className="pb-1 bg-black rounded-t-xl text-white">
                  <CardTitle className="text-sm font-bold">Ventas x año (línea)</CardTitle>
                </CardHeader>
                <CardContent>
                  {comparativaAnual.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-12">Sin datos históricos aún</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={comparativaAnual}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="anio" fontSize={11} />
                        <YAxis tickFormatter={(v) => `S/ ${(v/1000).toFixed(0)}k`} fontSize={10} />
                        <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                        <Line type="monotone" dataKey="ventas" stroke="#FBE600" strokeWidth={3} dot={{ fill: '#0A0A0A', r: 5 }} activeDot={{ r: 7 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-1 bg-black rounded-t-xl text-white">
                <CardTitle className="text-sm font-bold">Histórico por mes y año</CardTitle>
                <p className="text-[11px] text-gray-300">La barra junto a cada monto indica su tamaño relativo al mes pico</p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b sticky top-0 z-10">
                      <tr>
                        <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Año</th>
                        <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Mes</th>
                        <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Total Ventas</th>
                        <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Total Utilidad</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Margen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {historico.length === 0 ? (
                        <tr><td colSpan={5} className="py-12 text-center text-gray-400 text-xs">Sin datos históricos aún. Empieza a registrar pedidos.</td></tr>
                      ) : historico.map((h, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="py-1.5 px-3 text-xs text-gray-600">{h.anio}</td>
                          <td className="py-1.5 px-3 text-xs text-gray-800 capitalize">{MESES[h.mes]}</td>
                          <td className="py-1.5 px-3">
                            <BarraMonto valor={h.ventas} max={maxVentaMes} color="#FBE600" textColor="text-gray-900" />
                          </td>
                          <td className="py-1.5 px-3">
                            <BarraMonto valor={h.utilidad} max={maxUtilidadMes} color="#bfdbfe" textColor="text-blue-700" />
                          </td>
                          <td className="py-1.5 px-3 text-xs text-right">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${h.margenPct >= 20 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {h.margenPct}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// ─── Subcomponentes ──────────────────────────────────────────────────────────

function KpiVenta({ titulo, data, dataKey, color, headerClass, esPct }: any) {
  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader className={`pb-1 ${headerClass} rounded-t-xl`}>
        <CardTitle className="text-sm font-bold">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" fontSize={10} />
            <YAxis tickFormatter={(v) => esPct ? `${v}%` : `S/ ${(v/1000).toFixed(0)}k`} fontSize={9} />
            <Tooltip formatter={(v: any) => esPct ? `${v}%` : formatCurrency(Number(v))} />
            <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

function TablaFamilia({ data, maxVenta, maxUtilidad }: { data: any[]; maxVenta: number; maxUtilidad: number }) {
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const toggle = (familia: string) => {
    setExpandidas((prev) => {
      const next = new Set(prev)
      if (next.has(familia)) next.delete(familia)
      else next.add(familia)
      return next
    })
  }

  if (data.length === 0) {
    return <p className="text-xs text-gray-400 text-center py-12">Sin ventas en el período</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Familia / Producto</th>
            <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Ventas</th>
            <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Utilidad</th>
            <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Margen</th>
          </tr>
        </thead>
        <tbody>
          {data.map((fam, i) => {
            const exp = expandidas.has(fam.familia)
            const maxProdVenta = Math.max(1, ...fam.productos.map((p: any) => p.ventas))
            const maxProdUtil = Math.max(1, ...fam.productos.map((p: any) => p.utilidad))
            return (
              <>
                <tr
                  key={`fam-${i}`}
                  className="bg-yellow-50 border-b border-yellow-200 cursor-pointer hover:bg-yellow-100 transition-colors"
                  onClick={() => toggle(fam.familia)}
                >
                  <td className="py-2 px-3 text-xs font-bold text-gray-900">
                    <span className="inline-flex items-center gap-1">
                      {exp ? <ChevronDown className="w-4 h-4 text-gray-600" /> : <ChevronRight className="w-4 h-4 text-gray-600" />}
                      {fam.familia}
                    </span>
                  </td>
                  <td className="py-2 px-3"><BarraMonto valor={fam.ventas} max={maxVenta} color="#FBE600" textColor="text-gray-900 font-semibold" /></td>
                  <td className="py-2 px-3"><BarraMonto valor={fam.utilidad} max={maxUtilidad} color="#bfdbfe" textColor="text-blue-700" /></td>
                  <td className="py-2 px-3 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${fam.margen >= 20 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {fam.margen}%
                    </span>
                  </td>
                </tr>
                {exp && fam.productos.map((pr: any, j: number) => (
                  <tr key={`prod-${i}-${j}`} className="border-b border-gray-50 bg-white">
                    <td className="py-1.5 px-3 text-xs text-gray-600 pl-10">{pr.nombre}</td>
                    <td className="py-1.5 px-3"><BarraMonto valor={pr.ventas} max={maxProdVenta} color="#fde68a" textColor="text-gray-700" small /></td>
                    <td className="py-1.5 px-3"><BarraMonto valor={pr.utilidad} max={maxProdUtil} color="#dbeafe" textColor="text-blue-600" small /></td>
                    <td className="py-1.5 px-3 text-xs text-right text-gray-500">{pr.margen}%</td>
                  </tr>
                ))}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BarraMonto({ valor, max, color, textColor = '', small = false }: { valor: number; max: number; color: string; textColor?: string; small?: boolean }) {
  const pct = max > 0 ? Math.min(100, (valor / max) * 100) : 0
  return (
    <div className="relative w-full max-w-[180px]">
      <div className={`h-${small ? '4' : '5'} bg-gray-100 rounded relative overflow-hidden`}>
        <div className="absolute inset-y-0 left-0 rounded transition-all" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.65 }} />
        <div className={`relative z-10 px-2 ${small ? 'text-[10px] leading-4' : 'text-[11px] leading-5'} font-mono ${textColor}`}>
          {formatCurrency(valor)}
        </div>
      </div>
    </div>
  )
}
