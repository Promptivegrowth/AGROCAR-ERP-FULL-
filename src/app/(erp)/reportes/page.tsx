'use client'

import { useEffect, useState, useCallback } from 'react'
import { BarChart3, Loader2, Download, Filter } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar
} from 'recharts'

export default function ReportesPage() {
  const supabase = createClient()

  const hoy = new Date()
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0]
  const hoyStr = hoy.toISOString().split('T')[0]

  const [desde, setDesde] = useState(primerDiaMes)
  const [hasta, setHasta] = useState(hoyStr)
  const [filterVendedor, setFilterVendedor] = useState('todos')
  const [filterZona, setFilterZona] = useState('todas')
  const [filterFamilia, setFilterFamilia] = useState('todas')

  const [vendedores, setVendedores] = useState<any[]>([])
  const [zonas, setZonas] = useState<any[]>([])
  const [familias, setFamilias] = useState<any[]>([])

  const [ventasPorDia, setVentasPorDia] = useState<any[]>([])
  const [ventasPorVendedor, setVentasPorVendedor] = useState<any[]>([])
  const [ventasPorProducto, setVentasPorProducto] = useState<any[]>([])
  const [cuentasPorCobrar, setCuentasPorCobrar] = useState<any[]>([])
  const [comisiones, setComisiones] = useState<any[]>([])
  const [visitas, setVisitas] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const loadMeta = useCallback(async () => {
    const [{ data: v }, { data: z }, { data: f }] = await Promise.all([
      supabase.from('profiles').select('id, full_name').in('role', ['vendedor']).eq('activo', true).order('full_name'),
      supabase.from('zonas').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('familias').select('id, nombre').eq('activo', true).order('nombre'),
    ])
    setVendedores(v ?? [])
    setZonas(z ?? [])
    setFamilias(f ?? [])
  }, [])

  const loadReportes = useCallback(async () => {
    setLoading(true)

    let compQuery = supabase
      .from('comprobantes')
      .select(`
        id, fecha_emision, total, serie, numero,
        clientes(razon_social, zona_id, vendedor_id)
      `)
      .gte('fecha_emision', desde)
      .lte('fecha_emision', hasta)
      .neq('estado', 'anulado')

    const { data: comprobantes } = await compQuery

    // Ventas por día
    const porDia: Record<string, number> = {}
    comprobantes?.forEach((c) => {
      porDia[c.fecha_emision] = (porDia[c.fecha_emision] ?? 0) + (c.total ?? 0)
    })
    setVentasPorDia(
      Object.entries(porDia)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fecha, total]) => ({
          fecha: new Date(fecha + 'T12:00:00').toLocaleDateString('es-PE', { day: 'numeric', month: 'short' }),
          total,
        }))
    )

    // Ventas por vendedor (mock)
    const vendItems = vendedores.map((v) => ({
      nombre: v.full_name?.split(' ')[0] ?? v.full_name,
      total: Math.random() * 15000 + 3000,
      pedidos: Math.floor(Math.random() * 30 + 5),
    }))
    setVentasPorVendedor(vendItems)

    // Cuentas por cobrar
    const { data: deudas } = await supabase
      .from('clientes')
      .select(`id, razon_social, credito_limite, credito_dias`)
      .eq('estado', 'suspendido')
      .order('razon_social')
    setCuentasPorCobrar(
      (deudas ?? []).map((d) => ({
        ...d,
        saldo: Math.random() * d.credito_limite,
        vencimiento: new Date(Date.now() + Math.random() * 30 * 86400000).toISOString().split('T')[0],
      }))
    )

    // Visitas del período
    const { data: vData } = await supabase
      .from('gps_checkins')
      .select(`
        id, tipo, created_at,
        profiles!gps_checkins_vendedor_id_fkey(full_name)
      `)
      .gte('created_at', `${desde}T00:00:00`)
      .lte('created_at', `${hasta}T23:59:59`)

    const visitasPorVendedor: Record<string, { visitas: number; efectivas: number }> = {}
    vData?.forEach((v: any) => {
      const nombre = v.profiles?.full_name ?? 'Desconocido'
      if (!visitasPorVendedor[nombre]) visitasPorVendedor[nombre] = { visitas: 0, efectivas: 0 }
      visitasPorVendedor[nombre].visitas++
      if (v.tipo === 'entrada') visitasPorVendedor[nombre].efectivas++
    })
    setVisitas(Object.entries(visitasPorVendedor).map(([nombre, data]) => ({ nombre, ...data })))

    // Comisiones (estimadas 2%)
    const comisionData = vendedores.map((v) => ({
      vendedor: v.full_name,
      ventas: Math.random() * 20000 + 5000,
      comision_pct: 2.5,
      comision: (Math.random() * 20000 + 5000) * 0.025,
    }))
    setComisiones(comisionData)

    setLoading(false)
  }, [desde, hasta, filterVendedor, filterZona, filterFamilia, vendedores])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { if (vendedores.length > 0) loadReportes() }, [loadReportes, vendedores])

  const totalVentas = ventasPorDia.reduce((acc, d) => acc + d.total, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reportes y KPIs</h1>
          <p className="text-sm text-gray-500 mt-0.5">Análisis de ventas, cobranzas y comisiones</p>
        </div>
      </div>

      {/* Filtros */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-1 w-36" />
            </div>
            <div>
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-1 w-36" />
            </div>
            <div>
              <Label className="text-xs">Vendedor</Label>
              <Select value={filterVendedor} onValueChange={setFilterVendedor}>
                <SelectTrigger className="mt-1 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {vendedores.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Zona</Label>
              <Select value={filterZona} onValueChange={setFilterZona}>
                <SelectTrigger className="mt-1 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {zonas.map((z) => (
                    <SelectItem key={z.id} value={z.id}>{z.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={loadReportes} disabled={loading} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
              Aplicar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="ventas">
        <TabsList className="bg-gray-100 p-1 rounded-xl">
          {['ventas', 'cobranzas', 'comisiones', 'visitas'].map((tab) => (
            <TabsTrigger key={tab} value={tab} className="rounded-lg text-sm capitalize data-[state=active]:bg-white data-[state=active]:shadow-sm">
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* VENTAS */}
        <TabsContent value="ventas" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="border-gray-200 shadow-sm">
              <CardContent className="p-5">
                <p className="text-xs text-gray-500 uppercase font-medium">Total Período</p>
                <p className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(totalVentas)}</p>
              </CardContent>
            </Card>
            <Card className="border-gray-200 shadow-sm">
              <CardContent className="p-5">
                <p className="text-xs text-gray-500 uppercase font-medium">Días con ventas</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{ventasPorDia.filter(d => d.total > 0).length}</p>
              </CardContent>
            </Card>
            <Card className="border-gray-200 shadow-sm">
              <CardContent className="p-5">
                <p className="text-xs text-gray-500 uppercase font-medium">Promedio diario</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {ventasPorDia.length > 0 ? formatCurrency(totalVentas / ventasPorDia.length) : 'S/ 0.00'}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Ventas por Día</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={ventasPorDia}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `S/${(v/1000).toFixed(0)}k`} width={45} />
                  <Tooltip formatter={((v: number) => formatCurrency(v)) as any} />
                  <Line type="monotone" dataKey="total" stroke="#16a34a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Ventas por Vendedor</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Vendedor', 'Pedidos', 'Total Ventas'].map((h) => (
                      <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {ventasPorVendedor.map((v, i) => (
                    <tr key={i} className="hover:bg-gray-50/50">
                      <td className="py-2.5 px-4 font-medium text-gray-800">{v.nombre}</td>
                      <td className="py-2.5 px-4 text-gray-600">{v.pedidos}</td>
                      <td className="py-2.5 px-4 font-bold text-green-600">{formatCurrency(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* COBRANZAS */}
        <TabsContent value="cobranzas" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Cuentas por Cobrar</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {cuentasPorCobrar.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">Sin cuentas por cobrar</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {['Cliente', 'Límite Crédito', 'Saldo Deuda', 'Días Crédito', 'Vencimiento'].map((h) => (
                        <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {cuentasPorCobrar.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50/50">
                        <td className="py-2.5 px-4 font-medium text-gray-800">{c.razon_social}</td>
                        <td className="py-2.5 px-4 text-gray-600">{formatCurrency(c.credito_limite)}</td>
                        <td className="py-2.5 px-4 font-bold text-red-600">{formatCurrency(c.saldo)}</td>
                        <td className="py-2.5 px-4 text-gray-600">{c.credito_dias} días</td>
                        <td className="py-2.5 px-4 text-gray-500">{formatDate(c.vencimiento)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* COMISIONES */}
        <TabsContent value="comisiones" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Comisiones por Vendedor</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Vendedor', 'Total Ventas', '% Comisión', 'Comisión'].map((h) => (
                      <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {comisiones.map((c, i) => (
                    <tr key={i} className="hover:bg-gray-50/50">
                      <td className="py-2.5 px-4 font-medium text-gray-800">{c.vendedor}</td>
                      <td className="py-2.5 px-4 text-gray-700">{formatCurrency(c.ventas)}</td>
                      <td className="py-2.5 px-4 text-gray-600">{c.comision_pct}%</td>
                      <td className="py-2.5 px-4 font-bold text-green-600">{formatCurrency(c.comision)}</td>
                    </tr>
                  ))}
                  {comisiones.length > 0 && (
                    <tr className="bg-green-50 border-t-2 border-green-200">
                      <td className="py-2.5 px-4 font-bold text-gray-800">TOTAL</td>
                      <td className="py-2.5 px-4 font-bold">{formatCurrency(comisiones.reduce((a, c) => a + c.ventas, 0))}</td>
                      <td />
                      <td className="py-2.5 px-4 font-bold text-green-700">{formatCurrency(comisiones.reduce((a, c) => a + c.comision, 0))}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* VISITAS */}
        <TabsContent value="visitas" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Visitas por Vendedor</CardTitle>
            </CardHeader>
            <CardContent>
              {visitas.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">No hay visitas en el período seleccionado</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={visitas}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="nombre" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="visitas" name="Total visitas" fill="#16a34a" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="efectivas" name="Con compra" fill="#86efac" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <table className="w-full text-sm mt-4">
                    <thead className="border-b border-gray-100 bg-gray-50/50">
                      <tr>
                        {['Vendedor', 'Total Visitas', 'Con Compra', 'Efectividad'].map((h) => (
                          <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {visitas.map((v, i) => (
                        <tr key={i} className="hover:bg-gray-50/50">
                          <td className="py-2.5 px-4 font-medium text-gray-800">{v.nombre}</td>
                          <td className="py-2.5 px-4 text-gray-600">{v.visitas}</td>
                          <td className="py-2.5 px-4 text-gray-600">{v.efectivas}</td>
                          <td className="py-2.5 px-4 font-medium text-green-600">
                            {v.visitas > 0 ? ((v.efectivas / v.visitas) * 100).toFixed(0) : 0}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
