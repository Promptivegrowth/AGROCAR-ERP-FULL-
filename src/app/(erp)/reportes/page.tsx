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
  // Búsqueda por nombre o doc (RUC/DNI) en la tab Cobranzas
  const [busquedaCobranza, setBusquedaCobranza] = useState('')
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

    // Ventas por vendedor (datos reales: comprobantes agrupados por el vendedor del cliente)
    const ventasMap = new Map<string, { total: number; pedidos: number }>()
    comprobantes?.forEach((c: any) => {
      const vId = c.clientes?.vendedor_id
      if (!vId) return
      const cur = ventasMap.get(vId) ?? { total: 0, pedidos: 0 }
      cur.total += Number(c.total ?? 0)
      cur.pedidos += 1
      ventasMap.set(vId, cur)
    })
    const vendItems = vendedores.map((v) => {
      const d = ventasMap.get(v.id) ?? { total: 0, pedidos: 0 }
      return {
        nombre: v.full_name?.split(' ')[0] ?? v.full_name,
        total: d.total,
        pedidos: d.pedidos,
      }
    })
    setVentasPorVendedor(vendItems)

    // Cuentas por cobrar (real: facturado - cobrado por cliente)
    const [{ data: clientesActivos }, { data: comprAll }, { data: cobrosAll }] = await Promise.all([
      supabase.from('clientes').select('id, razon_social, ruc, dni, credito_limite, credito_dias').eq('estado', 'activo').order('razon_social'),
      supabase.from('comprobantes').select('cliente_id, total').neq('estado', 'anulado'),
      supabase.from('cobros').select('cliente_id, total'),
    ])
    const facturadoMap = new Map<string, number>()
    const cobradoMap = new Map<string, number>()
    ;(comprAll ?? []).forEach((c: any) => {
      if (c.cliente_id) facturadoMap.set(c.cliente_id, (facturadoMap.get(c.cliente_id) ?? 0) + Number(c.total ?? 0))
    })
    ;(cobrosAll ?? []).forEach((c: any) => {
      if (c.cliente_id) cobradoMap.set(c.cliente_id, (cobradoMap.get(c.cliente_id) ?? 0) + Number(c.total ?? 0))
    })
    const hoy = new Date()
    const deudas = (clientesActivos ?? [])
      .map((c: any) => {
        const fact = facturadoMap.get(c.id) ?? 0
        const cob = cobradoMap.get(c.id) ?? 0
        const saldo = Math.max(0, fact - cob)
        const venc = new Date(hoy)
        venc.setDate(hoy.getDate() + (c.credito_dias ?? 0))
        return { ...c, saldo, vencimiento: venc.toISOString().split('T')[0] }
      })
      .filter((c: any) => c.saldo > 0)
    setCuentasPorCobrar(deudas)

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

    // Comisiones por familia (usa RPC calcular_comision_vendedor)
    // Antes había un 2.5% hardcoded que ignoraba las reglas configuradas.
    const comisionPromises = vendedores.map(async (v) => {
      const { data: rpc } = await (supabase.rpc as any)('calcular_comision_vendedor', {
        p_vendedor_id: v.id, p_desde: desde, p_hasta: hasta,
      })
      const ventasReales = Number(rpc?.total_ventas ?? 0)
      const comision = Number(rpc?.total_comision ?? 0)
      const pct = ventasReales > 0 ? (comision / ventasReales) * 100 : 0
      return {
        vendedor: v.full_name,
        ventas: ventasReales,
        comision_pct: pct,
        comision,
        sin_regla: Number(rpc?.lineas_sin_regla ?? 0),
      }
    })
    const comisionData = await Promise.all(comisionPromises)
    setComisiones(comisionData)

    setLoading(false)
  }, [desde, hasta, filterVendedor, filterZona, filterFamilia, vendedores])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { if (vendedores.length > 0) loadReportes() }, [loadReportes, vendedores])

  const totalVentas = ventasPorDia.reduce((acc, d) => acc + d.total, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reportes y KPIs</h1>
          <p className="text-sm text-gray-500 mt-0.5">Análisis de ventas, cobranzas y comisiones</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/reportes/rendicion-diaria"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300 rounded-md hover:bg-amber-200"
            title="Rendición diaria por vendedor y repartidor"
          >
            📊 Rendición diaria
          </a>
          <a
            href="/reportes/ventas-productos"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-purple-100 text-purple-900 border border-purple-300 rounded-md hover:bg-purple-200"
            title="Productos y familias más vendidos"
          >
            🏆 Productos más vendidos
          </a>
          <a
            href="/reportes/catalogo"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-blue-100 text-blue-900 border border-blue-300 rounded-md hover:bg-blue-200"
            title="Catálogo completo con precios A/B/C"
          >
            📦 Catálogo de productos
          </a>
        </div>
      </div>

      {/* Acceso rápido a reportes individuales (selectores con búsqueda) */}
      <ReporteIndividualSelectores
        vendedores={vendedores}
        clientesPorCobrar={cuentasPorCobrar}
      />


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
        <TabsContent value="cobranzas" className="mt-4 space-y-3">
          {/* Botón rápido al reporte por vendedor (cuando hay filtro) */}
          {filterVendedor !== 'todos' && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs text-orange-900">
                📋 <strong>Vendedor seleccionado:</strong>{' '}
                {vendedores.find((v: any) => v.id === filterVendedor)?.full_name ?? '—'}
              </p>
              <a
                href={`/reportes/cobranzas-vendedor/${filterVendedor}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-orange-600 hover:bg-orange-700 text-white rounded-md"
              >
                Ver sus cuentas por cobrar →
              </a>
            </div>
          )}

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base font-semibold text-gray-800">Cuentas por Cobrar</CardTitle>
                <p className="text-[11px] text-gray-500">
                  💡 Click en el cliente para ver su estado de cuenta con opción de enviar por WhatsApp.
                </p>
              </div>
              {/* Buscador por nombre o RUC/DNI */}
              <div className="relative max-w-md">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
                <Input
                  type="text"
                  value={busquedaCobranza}
                  onChange={(e) => setBusquedaCobranza(e.target.value)}
                  placeholder="Buscar por nombre del cliente, RUC o DNI..."
                  className="pl-7 pr-9 h-8 text-xs"
                />
                {busquedaCobranza && (
                  <button onClick={() => setBusquedaCobranza('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs">
                    ✕
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {(() => {
                const q = busquedaCobranza.trim().toLowerCase()
                const filtrados = q.length === 0
                  ? cuentasPorCobrar
                  : cuentasPorCobrar.filter((c: any) =>
                      c.razon_social.toLowerCase().includes(q) ||
                      (c.ruc ?? '').toLowerCase().includes(q) ||
                      (c.dni ?? '').toLowerCase().includes(q),
                    )
                if (cuentasPorCobrar.length === 0) {
                  return <div className="text-center py-12 text-gray-400 text-sm">Sin cuentas por cobrar</div>
                }
                if (filtrados.length === 0) {
                  return <div className="text-center py-12 text-gray-400 text-sm">Ningún cliente coincide con &ldquo;{busquedaCobranza}&rdquo;</div>
                }
                return (
                  <>
                    <p className="text-[10px] text-gray-500 px-4 py-2 border-b border-gray-100">
                      Mostrando <strong>{filtrados.length}</strong> de {cuentasPorCobrar.length} clientes con deuda
                      {q && ` · filtro: ${busquedaCobranza}`}
                    </p>
                    <table className="w-full text-sm">
                      <thead className="border-b border-gray-100 bg-gray-50/50">
                        <tr>
                          {['Cliente', 'Doc.', 'Límite', 'Saldo Deuda', 'Días', 'Vencimiento', ''].map((h) => (
                            <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filtrados.map((c: any) => (
                          <tr key={c.id} className="hover:bg-blue-50/40 transition-colors group">
                            <td className="py-2.5 px-4 font-medium">
                              <a
                                href={`/reportes/cobranzas-cliente/${c.id}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-blue-700 hover:text-blue-900 hover:underline"
                                title="Abrir estado de cuenta detallado"
                              >
                                {c.razon_social} →
                              </a>
                            </td>
                            <td className="py-2.5 px-4 text-gray-500 font-mono text-xs">
                              {c.ruc ? `RUC ${c.ruc}` : c.dni ? `DNI ${c.dni}` : '—'}
                            </td>
                            <td className="py-2.5 px-4 text-gray-600">{formatCurrency(c.credito_limite)}</td>
                            <td className="py-2.5 px-4 font-bold text-red-600">{formatCurrency(c.saldo)}</td>
                            <td className="py-2.5 px-4 text-gray-600">{c.credito_dias} días</td>
                            <td className="py-2.5 px-4 text-gray-500">{formatDate(c.vencimiento)}</td>
                            <td className="py-2.5 px-4 text-right">
                              <a
                                href={`/reportes/cobranzas-cliente/${c.id}`}
                                target="_blank" rel="noopener noreferrer"
                                className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold bg-blue-600 hover:bg-blue-700 text-white rounded"
                                title="Estado de cuenta + WhatsApp"
                              >
                                💬 Estado de cuenta
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* COMISIONES */}
        <TabsContent value="comisiones" className="mt-4 space-y-3">
          {/* Banner cumplimiento de cuotas */}
          <div className="bg-gradient-to-r from-red-50 to-amber-50 border border-red-200 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-red-900">💰 Cuentas por cobrar de todos los vendedores</p>
              <p className="text-xs text-red-700">
                Cuánto hay por cobrar en total, agrupado por vendedor y cliente, con lo vencido y los días de atraso.
              </p>
            </div>
            <a href="/reportes/cuentas-por-cobrar" className="text-xs px-3 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-md">
              💰 Ver cuentas por cobrar →
            </a>
          </div>

          <div className="bg-gradient-to-r from-blue-50 to-emerald-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-blue-900">🎯 Cumplimiento de cuotas mensuales por vendedor × familia</p>
              <p className="text-xs text-blue-700">Asigna metas mensuales y mide el cumplimiento contra ventas reales.</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <a href="/vendedores/cuotas" className="text-xs px-3 py-2 bg-white hover:bg-blue-50 text-blue-700 font-semibold rounded-md border border-blue-200">
                ⚙ Cuotas por familia
              </a>
              <a href="/vendedores/cuotas/productos" className="text-xs px-3 py-2 bg-white hover:bg-blue-50 text-blue-700 font-semibold rounded-md border border-blue-200">
                📦 Cuotas por producto
              </a>
              <a href="/reportes/cumplimiento-cuotas" className="text-xs px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-md">
                📈 Ver cumplimiento →
              </a>
              <a href="/reportes/alcance-objetivos" className="text-xs px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md">
                📊 Alcance de objetivos →
              </a>
            </div>
          </div>
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
                      <td className="py-2.5 px-4 font-medium text-gray-800">
                        {c.vendedor}
                        {c.sin_regla > 0 && (
                          <span title="Líneas vendidas sin regla de comisión configurada (no generan comisión)"
                            className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 rounded">
                            ⚠ {c.sin_regla} sin regla
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-gray-700">{formatCurrency(c.ventas)}</td>
                      <td className="py-2.5 px-4 text-gray-600">{c.comision_pct.toFixed(2)}%</td>
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

/**
 * Selectores rápidos para abrir reportes individuales:
 * - Por VENDEDOR: cuentas por cobrar (cobranzas) + ventas históricas (persona)
 * - Por CLIENTE: estado de cuenta + historial de compras (ambos con WhatsApp)
 *
 * Dropdowns con búsqueda — escribes 2+ caracteres y filtra. Click selecciona
 * y abre el reporte en pestaña nueva.
 */
function ReporteIndividualSelectores({
  vendedores, clientesPorCobrar,
}: {
  vendedores: any[]
  clientesPorCobrar: any[]
}) {
  const [vendedorBuscar, setVendedorBuscar] = useState('')
  const [vendedorAbierto, setVendedorAbierto] = useState(false)
  const [vendedorSeleccionado, setVendedorSeleccionado] = useState<any>(null)

  const [clienteBuscar, setClienteBuscar] = useState('')
  const [clienteAbierto, setClienteAbierto] = useState(false)
  const [clientesTodos, setClientesTodos] = useState<any[]>([])
  const [clienteSeleccionado, setClienteSeleccionado] = useState<any>(null)

  // Cargar TODOS los clientes (no solo los con deuda) la primera vez que abren el dropdown
  const supabase = createClient()
  const cargarClientes = useCallback(async () => {
    if (clientesTodos.length > 0) return
    const { data } = await (supabase as any)
      .from('clientes')
      .select('id, razon_social, ruc, dni')
      .eq('estado', 'activo')
      .order('razon_social')
    setClientesTodos((data ?? []) as any[])
  }, [supabase, clientesTodos.length])

  const vendedoresFiltrados = (() => {
    const q = vendedorBuscar.trim().toLowerCase()
    if (q.length === 0) return vendedores.slice(0, 12)
    return vendedores
      .filter((v: any) => (v.full_name ?? '').toLowerCase().includes(q))
      .slice(0, 12)
  })()
  const clientesFiltrados = (() => {
    const q = clienteBuscar.trim().toLowerCase()
    const base = clientesTodos.length > 0 ? clientesTodos : clientesPorCobrar
    if (q.length === 0) return base.slice(0, 12)
    return base
      .filter((c: any) =>
        (c.razon_social ?? '').toLowerCase().includes(q) ||
        (c.ruc ?? '').toLowerCase().includes(q) ||
        (c.dni ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12)
  })()

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold text-blue-900 flex items-center gap-1">
          🎯 Abrir reporte individual (selecciona y click)
        </p>
        {/* El equipo completo en un solo documento: Daniel lo pidió para no
            tener que abrir uno por uno y poder comparar de un vistazo. */}
        <a
          href="/reportes/equipo"
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold bg-blue-700 hover:bg-blue-800 text-white rounded-md"
        >
          👥 Todos en un solo reporte →
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Selector VENDEDOR */}
        <div className="relative">
          <Label className="text-[10px] text-blue-800 uppercase">Por VENDEDOR</Label>
          <Input
            type="text"
            placeholder="Buscar vendedor por nombre..."
            value={vendedorBuscar}
            onChange={(e) => { setVendedorBuscar(e.target.value); setVendedorAbierto(true); setVendedorSeleccionado(null) }}
            onFocus={() => setVendedorAbierto(true)}
            onBlur={() => setTimeout(() => setVendedorAbierto(false), 200)}
            className="h-9 text-sm bg-white"
            autoComplete="off"
          />
          {vendedorAbierto && vendedoresFiltrados.length > 0 && (
            <div className="absolute z-50 mt-1 left-0 right-0 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {vendedoresFiltrados.map((v: any) => (
                <button
                  key={v.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setVendedorSeleccionado(v)
                    setVendedorBuscar(v.full_name)
                    setVendedorAbierto(false)
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0 text-sm"
                >
                  <p className="font-semibold">{v.full_name}</p>
                  <p className="text-[10px] text-gray-500 capitalize">{v.role}</p>
                </button>
              ))}
            </div>
          )}
          {vendedorSeleccionado && (
            <div className="mt-2 flex gap-2 flex-wrap">
              <a
                href={`/reportes/cobranzas-vendedor/${vendedorSeleccionado.id}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-md"
              >
                📋 Cuentas por cobrar →
              </a>
              <a
                href={`/reportes/persona/${vendedorSeleccionado.id}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-md"
              >
                📊 Ventas históricas →
              </a>
            </div>
          )}
        </div>

        {/* Selector CLIENTE */}
        <div className="relative">
          <Label className="text-[10px] text-blue-800 uppercase">Por CLIENTE</Label>
          <Input
            type="text"
            placeholder="Buscar cliente por nombre, RUC o DNI..."
            value={clienteBuscar}
            onChange={(e) => { setClienteBuscar(e.target.value); setClienteAbierto(true); setClienteSeleccionado(null) }}
            onFocus={() => { cargarClientes(); setClienteAbierto(true) }}
            onBlur={() => setTimeout(() => setClienteAbierto(false), 200)}
            className="h-9 text-sm bg-white"
            autoComplete="off"
          />
          {clienteAbierto && clientesFiltrados.length > 0 && (
            <div className="absolute z-50 mt-1 left-0 right-0 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {clientesFiltrados.map((c: any) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setClienteSeleccionado(c)
                    setClienteBuscar(c.razon_social)
                    setClienteAbierto(false)
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0 text-sm"
                >
                  <p className="font-semibold truncate">{c.razon_social}</p>
                  <p className="text-[10px] text-gray-500 font-mono">
                    {c.ruc ? `RUC ${c.ruc}` : c.dni ? `DNI ${c.dni}` : 'Sin doc'}
                  </p>
                </button>
              ))}
            </div>
          )}
          {clienteSeleccionado && (
            <div className="mt-2 flex gap-2 flex-wrap">
              <a
                href={`/reportes/cobranzas-cliente/${clienteSeleccionado.id}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-md"
              >
                💰 Estado de cuenta + WhatsApp →
              </a>
              <a
                href={`/reportes/cliente/${clienteSeleccionado.id}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold bg-green-600 hover:bg-green-700 text-white rounded-md"
              >
                🛒 Historial de compras →
              </a>
            </div>
          )}
        </div>
      </div>

      <p className="text-[10px] text-blue-700 italic">
        Tip: el banner naranja en la tab Cobranzas también permite click directo en cada cliente para ver su estado de cuenta.
      </p>
    </div>
  )
}
