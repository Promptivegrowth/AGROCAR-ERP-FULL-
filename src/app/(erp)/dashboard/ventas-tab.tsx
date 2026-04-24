'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, ComposedChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TrendingUp, DollarSign, Percent, Loader2, Zap } from 'lucide-react'

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const COLORS_PIE = ['#FBE600', '#0A0A0A', '#94a3b8', '#1e40af', '#16a34a', '#dc2626', '#7c3aed']
// Margen de utilidad asumido del 22% de las ventas (cost of goods = 78%)
const MARGEN_UTILIDAD = 0.22

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
            pedidos_items(cantidad, subtotal, productos(id, codigo, nombre, familias(id, nombre)))
          `)
          .gte('fecha_pedido', `${anio}-01-01`)
          .lte('fecha_pedido', `${anio}-12-31`)
          .in('estado', ['facturado','despachado','entregado']),
        (supabase as any)
          .from('pedidos')
          .select('fecha_pedido, total')
          .in('estado', ['facturado','despachado','entregado']),
      ])
      setPedidos(p ?? [])
      setPedidosAll(pAll ?? [])
      setLoading(false)
    })()
  }, [anio])

  // Filtro por familia
  const pedidosFiltrados = useMemo(() => {
    if (familiaSel === 'todas') return pedidos
    return pedidos.map((p: any) => ({
      ...p,
      pedidos_items: (p.pedidos_items ?? []).filter((it: any) => it.productos?.familias?.id === familiaSel),
    })).filter((p: any) => p.pedidos_items.length > 0)
  }, [pedidos, familiaSel])

  const calcTotal = (p: any) => (p.pedidos_items ?? []).reduce((a: number, it: any) => a + Number(it.subtotal ?? 0), 0)

  const totalVentas = pedidosFiltrados.reduce((a, p) => a + calcTotal(p), 0)
  const totalUtilidad = totalVentas * MARGEN_UTILIDAD
  const margenPct = totalVentas > 0 ? (totalUtilidad / totalVentas) * 100 : 0

  // Predictivo fin de año
  const mesesCompletados = Math.min(now.getMonth() + (now.getFullYear() === anio ? 0 : 12), 12)
  const diaHoy = now.getFullYear() === anio ? now.getDate() : 31
  const totalDias = now.getFullYear() === anio ? Math.ceil((now.getTime() - new Date(anio, 0, 1).getTime()) / 86400000) : 365
  const proyeccionAnual = totalDias > 0 ? (totalVentas / totalDias) * 365 : 0

  // Trimestres
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
      const v = calcTotal(p)
      res[q].ventas += v
      res[q].utilidad += v * MARGEN_UTILIDAD
    })
    return res.map((r) => ({
      ...r,
      ventas: Math.round(r.ventas),
      utilidad: Math.round(r.utilidad),
      margen: r.ventas > 0 ? Math.round((r.utilidad / r.ventas) * 100) : 0,
    }))
  }, [pedidosFiltrados])

  // Ventas por familia (donut)
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

  // Tabla por familia con margen
  const tablaFamilia = useMemo(() => {
    const map = new Map<string, { familia: string; ventas: number; productos: Map<string, number> }>()
    pedidosFiltrados.forEach((p: any) => {
      ;(p.pedidos_items ?? []).forEach((it: any) => {
        const fam = it.productos?.familias?.nombre ?? 'Sin familia'
        const prev = map.get(fam) ?? { familia: fam, ventas: 0, productos: new Map() }
        prev.ventas += Number(it.subtotal ?? 0)
        const pn = it.productos?.nombre ?? '—'
        prev.productos.set(pn, (prev.productos.get(pn) ?? 0) + Number(it.subtotal ?? 0))
        map.set(fam, prev)
      })
    })
    return Array.from(map.values()).map((r) => ({
      familia: r.familia,
      ventas: Math.round(r.ventas),
      utilidad: Math.round(r.ventas * MARGEN_UTILIDAD),
      margen: Math.round(MARGEN_UTILIDAD * 100),
      productos: Array.from(r.productos.entries())
        .map(([nombre, v]) => ({ nombre, ventas: Math.round(v), utilidad: Math.round(v * MARGEN_UTILIDAD), margen: Math.round(MARGEN_UTILIDAD * 100) }))
        .sort((a, b) => b.ventas - a.ventas)
        .slice(0, 3),
    })).sort((a, b) => b.ventas - a.ventas)
  }, [pedidosFiltrados])

  // Comparativa anual (todos los años)
  const comparativaAnual = useMemo(() => {
    const map = new Map<number, number>()
    pedidosAll.forEach((p: any) => {
      const y = new Date(p.fecha_pedido + 'T12:00:00').getFullYear()
      map.set(y, (map.get(y) ?? 0) + Number(p.total ?? 0))
    })
    return Array.from(map.entries())
      .map(([anio, total]) => ({ anio, ventas: Math.round(total), margen: Math.round(MARGEN_UTILIDAD * 100) }))
      .sort((a, b) => a.anio - b.anio)
  }, [pedidosAll])

  // Histórico mes/año
  const historico = useMemo(() => {
    const map = new Map<string, { anio: number; mes: number; ventas: number }>()
    pedidosAll.forEach((p: any) => {
      const d = new Date(p.fecha_pedido + 'T12:00:00')
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const prev = map.get(key) ?? { anio: d.getFullYear(), mes: d.getMonth(), ventas: 0 }
      prev.ventas += Number(p.total ?? 0)
      map.set(key, prev)
    })
    return Array.from(map.values())
      .map((r) => ({
        ...r,
        ventas: Math.round(r.ventas),
        utilidad: Math.round(r.ventas * MARGEN_UTILIDAD),
        margenPct: Math.round(MARGEN_UTILIDAD * 100),
      }))
      .sort((a, b) => b.anio - a.anio || b.mes - a.mes)
      .slice(0, 18)
  }, [pedidosAll])

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="bg-slate-800 text-white rounded-xl p-3">
        <p className="text-[10px] uppercase tracking-widest text-center text-slate-400 mb-2">Filtros</p>
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
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
        <>
          {/* 3 KPI Trimestres grandes */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <KpiVenta
              titulo={`TOTAL VENTAS: ${formatCurrency(totalVentas)}`}
              data={trimestres}
              dataKey="ventas"
              color="#1e40af"
              headerClass="bg-slate-800 text-white"
            />
            <KpiVenta
              titulo={`TOTAL UTILIDAD: ${formatCurrency(totalUtilidad)}`}
              data={trimestres}
              dataKey="utilidad"
              color="#FBE600"
              headerClass="bg-[#FBE600] text-gray-900"
            />
            <KpiVenta
              titulo={`MARGEN UTILIDAD: ${margenPct.toFixed(0)}%`}
              data={trimestres}
              dataKey="margen"
              color="#0A0A0A"
              headerClass="bg-gray-200 text-gray-900"
              esPct
            />
          </div>

          {/* Card predictivo */}
          <Card className="border-gray-200 shadow-sm bg-gradient-to-br from-yellow-50 to-amber-100 border-amber-200">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-[#FBE600] flex items-center justify-center shrink-0">
                <Zap className="w-6 h-6 text-gray-900" />
              </div>
              <div className="flex-1">
                <p className="text-[11px] uppercase tracking-wide text-amber-900 font-bold">Proyección Fin de Año {anio}</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(proyeccionAnual)}</p>
                <p className="text-xs text-gray-700">
                  Basado en el ritmo diario actual · Utilidad estimada {formatCurrency(proyeccionAnual * MARGEN_UTILIDAD)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Donut + tabla familia */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="border-gray-200 shadow-sm lg:col-span-1">
              <CardHeader className="pb-1">
                <CardTitle className="bg-[#FBE600] inline-block px-4 py-1 rounded font-bold text-gray-900 text-sm">
                  Ventas por familia
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={porFamilia}
                      dataKey="total"
                      nameKey="nombre"
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={90}
                      label={(e: any) => `${(e.percent * 100).toFixed(0)}%`}
                    >
                      {porFamilia.map((_, idx) => <Cell key={idx} fill={COLORS_PIE[idx % COLORS_PIE.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-gray-200 shadow-sm lg:col-span-2">
              <CardHeader className="pb-1">
                <CardTitle className="bg-[#FBE600] inline-block px-4 py-1 rounded font-bold text-gray-900 text-sm">
                  Totales por familia y productos
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Familia / Producto</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Ventas</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Utilidad</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Margen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tablaFamilia.map((fam, i) => (
                        <><tr key={i} className="bg-yellow-50 border-b border-yellow-200">
                          <td className="py-2 px-3 text-xs font-bold text-gray-900">➕ {fam.familia}</td>
                          <td className="py-2 px-3 text-xs font-semibold text-gray-900 text-right">{formatCurrency(fam.ventas)}</td>
                          <td className="py-2 px-3 text-xs text-blue-700 text-right">{formatCurrency(fam.utilidad)}</td>
                          <td className="py-2 px-3 text-right">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${fam.margen >= 20 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {fam.margen}%
                            </span>
                          </td>
                        </tr>
                        {fam.productos.map((pr, j) => (
                          <tr key={`${i}-${j}`} className="border-b border-gray-50">
                            <td className="py-1.5 px-3 text-xs text-gray-600 pl-10">{pr.nombre}</td>
                            <td className="py-1.5 px-3 text-xs text-gray-700 text-right">{formatCurrency(pr.ventas)}</td>
                            <td className="py-1.5 px-3 text-xs text-gray-600 text-right">{formatCurrency(pr.utilidad)}</td>
                            <td className="py-1.5 px-3 text-xs text-gray-500 text-right">{pr.margen}%</td>
                          </tr>
                        ))}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Comparativa anual + histórico */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-1 bg-black rounded-t-xl text-white">
                <CardTitle className="text-sm font-bold">Comparativa anual: ventas x margen utilidad</CardTitle>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>

            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-1 bg-black rounded-t-xl text-white">
                <CardTitle className="text-sm font-bold">Histórico por mes y año</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Año</th>
                        <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Mes</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Ventas</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Utilidad</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-700 uppercase">Margen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {historico.map((h, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="py-1.5 px-3 text-xs text-gray-600">{h.anio}</td>
                          <td className="py-1.5 px-3 text-xs text-gray-800 capitalize">{MESES[h.mes]}</td>
                          <td className="py-1.5 px-3 text-xs font-semibold text-gray-900 text-right bg-yellow-50">{formatCurrency(h.ventas)}</td>
                          <td className="py-1.5 px-3 text-xs text-blue-700 text-right bg-blue-50">{formatCurrency(h.utilidad)}</td>
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
          </div>
        </>
      )}
    </div>
  )
}

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
            <YAxis
              tickFormatter={(v) => esPct ? `${v}%` : `S/ ${(v/1000).toFixed(0)}k`}
              fontSize={9}
            />
            <Tooltip formatter={(v: any) => esPct ? `${v}%` : formatCurrency(Number(v))} />
            <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
