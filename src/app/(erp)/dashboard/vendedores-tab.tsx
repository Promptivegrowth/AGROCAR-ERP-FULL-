'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Users, TrendingUp, ShoppingCart, Target, Receipt, MapPin,
  Loader2, Award, Activity, CreditCard,
} from 'lucide-react'

type Vendedor = { id: string; full_name: string; email: string; zona: string | null }
type Periodo = '7' | '30' | '90'
type Pedido = {
  id: string; vendedor_id: string; fecha_pedido: string; total: number; estado: string
  cliente: { razon_social: string; zona_nombre: string | null; distrito: string | null; tipo_comprobante_preferido: string | null }
  items: Array<{ cantidad: number; precio_unitario: number; subtotal: number; producto_nombre: string; familia_nombre: string | null }>
}
type Cobro = { vendedor_id: string | null; fecha: string; total: number }
type Checkin = { vendedor_id: string; cliente_id: string | null; created_at: string }
type Meta = { vendedor_id: string; anio: number; mes: number; monto_meta: number }

const COLORS_PIE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d']
const BRAND = '#FBE600'

function toISODate(d: Date) { return d.toISOString().split('T')[0] }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d }

export default function VendedoresTab() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [vendedorSel, setVendedorSel] = useState<string>('todos')
  const [periodo, setPeriodo] = useState<Periodo>('30')
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cobros, setCobros] = useState<Cobro[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [metas, setMetas] = useState<Meta[]>([])

  // Cargar vendedores una sola vez
  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, zonas!profiles_zona_id_fkey(nombre)')
        .eq('role', 'vendedor')
        .eq('activo', true)
        .order('full_name')
      setVendedores((data ?? []).map((v: any) => ({
        id: v.id, full_name: v.full_name, email: v.email, zona: v.zonas?.nombre ?? null,
      })))
    })()
  }, [])

  // Cargar datos del período seleccionado
  useEffect(() => {
    const desde = toISODate(daysAgo(Number(periodo)))
    ;(async () => {
      setLoading(true)
      const [{ data: p }, { data: c }, { data: g }, { data: m }] = await Promise.all([
        (supabase as any)
          .from('pedidos')
          .select(`
            id, vendedor_id, fecha_pedido, total, estado,
            clientes(razon_social, distrito, tipo_comprobante_preferido, zonas(nombre)),
            pedidos_items(cantidad, precio_unitario, subtotal, productos(nombre, familias(nombre)))
          `)
          .gte('fecha_pedido', desde)
          .in('estado', ['facturado','despachado','entregado'])
          .order('fecha_pedido', { ascending: true }),
        (supabase as any)
          .from('cobros')
          .select('cobrador_id, fecha, total')
          .gte('fecha', desde),
        (supabase as any)
          .from('gps_checkins')
          .select('usuario_id, cliente_id, created_at')
          .gte('created_at', desde + 'T00:00:00'),
        (supabase as any)
          .from('metas_vendedor')
          .select('vendedor_id, anio, mes, monto_meta')
          .eq('periodo', 'mensual'),
      ])
      setPedidos((p ?? []).map((x: any) => ({
        id: x.id,
        vendedor_id: x.vendedor_id,
        fecha_pedido: x.fecha_pedido,
        total: Number(x.total ?? 0),
        estado: x.estado,
        cliente: {
          razon_social: x.clientes?.razon_social ?? '—',
          zona_nombre: x.clientes?.zonas?.nombre ?? null,
          distrito: x.clientes?.distrito ?? null,
          tipo_comprobante_preferido: x.clientes?.tipo_comprobante_preferido ?? null,
        },
        items: (x.pedidos_items ?? []).map((it: any) => ({
          cantidad: Number(it.cantidad),
          precio_unitario: Number(it.precio_unitario),
          subtotal: Number(it.subtotal),
          producto_nombre: it.productos?.nombre ?? '—',
          familia_nombre: it.productos?.familias?.nombre ?? null,
        })),
      })))
      setCobros((c ?? []).map((x: any) => ({ vendedor_id: x.cobrador_id, fecha: x.fecha, total: Number(x.total ?? 0) })))
      setCheckins((g ?? []).map((x: any) => ({ vendedor_id: x.usuario_id, cliente_id: x.cliente_id, created_at: x.created_at })))
      setMetas((m ?? []).map((x: any) => ({ vendedor_id: x.vendedor_id, anio: x.anio, mes: x.mes, monto_meta: Number(x.monto_meta) })))
      setLoading(false)
    })()
  }, [periodo])

  // Filtrar por vendedor seleccionado
  const pedidosFiltrados = useMemo(
    () => vendedorSel === 'todos' ? pedidos : pedidos.filter((p) => p.vendedor_id === vendedorSel),
    [pedidos, vendedorSel],
  )
  const cobrosFiltrados = useMemo(
    () => vendedorSel === 'todos' ? cobros : cobros.filter((c) => c.vendedor_id === vendedorSel),
    [cobros, vendedorSel],
  )
  const checkinsFiltrados = useMemo(
    () => vendedorSel === 'todos' ? checkins : checkins.filter((c) => c.vendedor_id === vendedorSel),
    [checkins, vendedorSel],
  )

  // ─ KPIs ──────────────────────────────────────────────────────────────
  const ventasTotal = pedidosFiltrados.reduce((a, p) => a + p.total, 0)
  const pedidosCount = pedidosFiltrados.length
  const ticketPromedio = pedidosCount > 0 ? ventasTotal / pedidosCount : 0
  const clientesUnicos = new Set(pedidosFiltrados.map((p) => p.cliente.razon_social)).size
  const totalCobrado = cobrosFiltrados.reduce((a, c) => a + c.total, 0)
  const tasaCobro = ventasTotal > 0 ? (totalCobrado / ventasTotal) * 100 : 0
  const visitasGps = checkinsFiltrados.length
  const tasaConversion = visitasGps > 0 ? (pedidosCount / visitasGps) * 100 : 0

  // Meta del mes actual
  const now = new Date()
  const metaMesActual = useMemo(() => {
    const mesActual = now.getMonth() + 1
    const anioActual = now.getFullYear()
    if (vendedorSel === 'todos') {
      return metas.filter((m) => m.mes === mesActual && m.anio === anioActual).reduce((a, m) => a + m.monto_meta, 0)
    }
    const m = metas.find((x) => x.vendedor_id === vendedorSel && x.mes === mesActual && x.anio === anioActual)
    return m?.monto_meta ?? 0
  }, [metas, vendedorSel])
  const ventasMesActual = useMemo(() => {
    const mesActual = now.getMonth()
    return pedidosFiltrados
      .filter((p) => new Date(p.fecha_pedido + 'T12:00:00').getMonth() === mesActual)
      .reduce((a, p) => a + p.total, 0)
  }, [pedidosFiltrados])
  const pctMeta = metaMesActual > 0 ? (ventasMesActual / metaMesActual) * 100 : 0

  // ─ Series para gráficos ──────────────────────────────────────────────
  // 1. Ventas por día
  const ventasPorDia = useMemo(() => {
    const map = new Map<string, number>()
    const desde = daysAgo(Number(periodo))
    for (let d = new Date(desde); d <= now; d.setDate(d.getDate() + 1)) {
      map.set(toISODate(d), 0)
    }
    pedidosFiltrados.forEach((p) => {
      map.set(p.fecha_pedido, (map.get(p.fecha_pedido) ?? 0) + p.total)
    })
    return Array.from(map.entries()).map(([d, t]) => ({
      dia: new Date(d + 'T12:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }),
      total: Math.round(t * 100) / 100,
    }))
  }, [pedidosFiltrados, periodo])

  // 2. Meta vs real por mes (últimos 3 meses)
  const metaVsReal = useMemo(() => {
    const result: Array<{ mes: string; meta: number; real: number }> = []
    for (let i = 2; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const label = d.toLocaleDateString('es-PE', { month: 'short', year: '2-digit' })
      const mes = d.getMonth() + 1
      const anio = d.getFullYear()
      const meta = vendedorSel === 'todos'
        ? metas.filter((m) => m.mes === mes && m.anio === anio).reduce((a, m) => a + m.monto_meta, 0)
        : metas.find((m) => m.vendedor_id === vendedorSel && m.mes === mes && m.anio === anio)?.monto_meta ?? 0
      const real = pedidosFiltrados
        .filter((p) => {
          const fp = new Date(p.fecha_pedido + 'T12:00:00')
          return fp.getMonth() === d.getMonth() && fp.getFullYear() === d.getFullYear()
        })
        .reduce((a, p) => a + p.total, 0)
      result.push({ mes: label, meta: Math.round(meta), real: Math.round(real) })
    }
    return result
  }, [pedidosFiltrados, metas, vendedorSel])

  // 3. Top familias
  const topFamilias = useMemo(() => {
    const map = new Map<string, number>()
    pedidosFiltrados.forEach((p) => {
      p.items.forEach((it) => {
        const f = it.familia_nombre ?? 'Sin familia'
        map.set(f, (map.get(f) ?? 0) + it.subtotal)
      })
    })
    return Array.from(map.entries())
      .map(([nombre, total]) => ({ nombre, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
  }, [pedidosFiltrados])

  // 4. Ventas por zona
  const ventasPorZona = useMemo(() => {
    const map = new Map<string, number>()
    pedidosFiltrados.forEach((p) => {
      const z = p.cliente.zona_nombre ?? 'Sin zona'
      map.set(z, (map.get(z) ?? 0) + p.total)
    })
    return Array.from(map.entries())
      .map(([zona, total]) => ({ zona, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
  }, [pedidosFiltrados])

  // 5. Mix factura/boleta
  const mixComprobantes = useMemo(() => {
    let f = 0, b = 0
    pedidosFiltrados.forEach((p) => {
      if (p.cliente.tipo_comprobante_preferido === 'factura') f += p.total
      else b += p.total
    })
    return [
      { name: 'Factura', value: Math.round(f * 100) / 100 },
      { name: 'Boleta', value: Math.round(b * 100) / 100 },
    ]
  }, [pedidosFiltrados])

  // 6. Ranking de vendedores (solo si "todos")
  const rankingVendedores = useMemo(() => {
    if (vendedorSel !== 'todos') return []
    const map = new Map<string, number>()
    pedidos.forEach((p) => {
      map.set(p.vendedor_id, (map.get(p.vendedor_id) ?? 0) + p.total)
    })
    return vendedores
      .map((v) => ({ nombre: v.full_name.split(' ')[0] + ' ' + (v.full_name.split(' ')[1] ?? ''), ventas: Math.round((map.get(v.id) ?? 0) * 100) / 100 }))
      .sort((a, b) => b.ventas - a.ventas)
  }, [pedidos, vendedores, vendedorSel])

  // 7. Top clientes
  const topClientes = useMemo(() => {
    const map = new Map<string, number>()
    pedidosFiltrados.forEach((p) => {
      map.set(p.cliente.razon_social, (map.get(p.cliente.razon_social) ?? 0) + p.total)
    })
    return Array.from(map.entries())
      .map(([cliente, total]) => ({ cliente, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
  }, [pedidosFiltrados])

  // 8. Top productos
  const topProductos = useMemo(() => {
    const map = new Map<string, { cant: number; total: number }>()
    pedidosFiltrados.forEach((p) => {
      p.items.forEach((it) => {
        const prev = map.get(it.producto_nombre) ?? { cant: 0, total: 0 }
        map.set(it.producto_nombre, { cant: prev.cant + it.cantidad, total: prev.total + it.subtotal })
      })
    })
    return Array.from(map.entries())
      .map(([producto, v]) => ({ producto, cantidad: v.cant, total: Math.round(v.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
  }, [pedidosFiltrados])

  return (
    <div className="space-y-5">
      {/* Selectores */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Vendedor</p>
            <Select value={vendedorSel} onValueChange={setVendedorSel}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">
                  <span className="font-medium">Todos los vendedores ({vendedores.length})</span>
                </SelectItem>
                {vendedores.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.full_name} {v.zona ? `· ${v.zona}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Período</p>
            <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 días</SelectItem>
                <SelectItem value="30">Últimos 30 días</SelectItem>
                <SelectItem value="90">Últimos 90 días</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Cumplimiento del mes</p>
            <div className="h-10 flex items-center gap-2">
              <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pctMeta >= 100 ? 'bg-green-500' : pctMeta >= 70 ? 'bg-[#FBE600]' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(pctMeta, 100)}%` }}
                />
              </div>
              <span className="text-sm font-bold text-gray-800 font-mono">{Math.round(pctMeta)}%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-7 h-7 text-green-600 animate-spin" />
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiCard icon={TrendingUp} label="Ventas" value={formatCurrency(ventasTotal)} color="green" />
            <KpiCard icon={ShoppingCart} label="Pedidos" value={String(pedidosCount)} color="blue" />
            <KpiCard icon={Receipt} label="Ticket promedio" value={formatCurrency(ticketPromedio)} color="purple" />
            <KpiCard icon={Users} label="Clientes únicos" value={String(clientesUnicos)} color="orange" />
            <KpiCard icon={CreditCard} label="Tasa de cobro" value={`${tasaCobro.toFixed(1)}%`} color="pink" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MiniKpi icon={Target} label="Meta del mes" value={formatCurrency(metaMesActual)} />
            <MiniKpi icon={Activity} label="Visitas GPS" value={String(visitasGps)} />
            <MiniKpi icon={Award} label="Tasa conversión" value={`${tasaConversion.toFixed(1)}%`} desc="pedidos / visitas" />
            <MiniKpi icon={CreditCard} label="Cobrado" value={formatCurrency(totalCobrado)} />
          </div>

          {/* Ranking (solo todos) */}
          {vendedorSel === 'todos' && rankingVendedores.length > 0 && (
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-500" /> Ranking de vendedores
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={rankingVendedores} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" tickFormatter={(v) => `S/ ${(v / 1000).toFixed(1)}k`} fontSize={11} />
                    <YAxis type="category" dataKey="nombre" fontSize={11} width={100} />
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Bar dataKey="ventas" fill={BRAND} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Grid principal de gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Ventas por día</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={ventasPorDia}>
                    <defs>
                      <linearGradient id="gradVentas" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#16a34a" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="#16a34a" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="dia" fontSize={10} />
                    <YAxis tickFormatter={(v) => `S/ ${(v / 1000).toFixed(1)}k`} fontSize={10} />
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Area type="monotone" dataKey="total" stroke="#16a34a" strokeWidth={2} fill="url(#gradVentas)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Meta vs Realizado (últimos 3 meses)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={metaVsReal}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="mes" fontSize={11} />
                    <YAxis tickFormatter={(v) => `S/ ${(v / 1000).toFixed(0)}k`} fontSize={10} />
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="meta" fill="#94a3b8" name="Meta" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="real" fill="#16a34a" name="Real" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Top 5 familias</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={topFamilias} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" tickFormatter={(v) => `S/ ${(v / 1000).toFixed(1)}k`} fontSize={10} />
                    <YAxis type="category" dataKey="nombre" fontSize={11} width={110} />
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Bar dataKey="total" fill="#2563eb" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-gray-500" /> Ventas por zona
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={ventasPorZona} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" tickFormatter={(v) => `S/ ${(v / 1000).toFixed(1)}k`} fontSize={10} />
                    <YAxis type="category" dataKey="zona" fontSize={11} width={80} />
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Bar dataKey="total" fill="#7c3aed" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Mix Factura vs Boleta</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={mixComprobantes}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      innerRadius={50}
                      label={(e: any) => `${e.name}: ${(e.percent * 100).toFixed(0)}%`}
                    >
                      {mixComprobantes.map((entry, idx) => (
                        <Cell key={entry.name} fill={idx === 0 ? '#2563eb' : '#64748b'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Evolución acumulada</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={ventasPorDia.reduce<any[]>((acc, cur) => {
                    const prev = acc.length > 0 ? acc[acc.length - 1].acumulado : 0
                    acc.push({ ...cur, acumulado: prev + cur.total })
                    return acc
                  }, [])}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="dia" fontSize={10} />
                    <YAxis tickFormatter={(v) => `S/ ${(v / 1000).toFixed(0)}k`} fontSize={10} />
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Line type="monotone" dataKey="acumulado" stroke="#dc2626" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Tablas top */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Top 10 clientes</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <TablaTop headers={['#', 'Cliente', 'Total']} rows={topClientes.map((r, i) => [String(i + 1), r.cliente, formatCurrency(r.total)])} />
              </CardContent>
            </Card>

            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Top 10 productos</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <TablaTop headers={['#', 'Producto', 'Cant.', 'Total']} rows={topProductos.map((r, i) => [String(i + 1), r.producto, String(r.cantidad), formatCurrency(r.total)])} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: 'green' | 'blue' | 'purple' | 'orange' | 'pink' }) {
  const colors: Record<string, string> = {
    green: 'bg-green-50 text-green-600',
    blue: 'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
    pink: 'bg-pink-50 text-pink-600',
  }
  return (
    <Card className="border-gray-200 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{value}</p>
          </div>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MiniKpi({ icon: Icon, label, value, desc }: { icon: any; label: string; value: string; desc?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3">
      <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
        <Icon className="w-4 h-4 text-gray-600" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">{label}</p>
        <p className="text-sm font-semibold text-gray-900">{value}</p>
        {desc && <p className="text-[9px] text-gray-400">{desc}</p>}
      </div>
    </div>
  )
}

function TablaTop({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-gray-400 text-center py-8">Sin datos en el período</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left px-3 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50/50">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-3 py-2 text-xs ${j === 0 ? 'text-gray-400 font-mono w-8' : j === row.length - 1 ? 'font-semibold text-gray-800 text-right' : 'text-gray-700'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
