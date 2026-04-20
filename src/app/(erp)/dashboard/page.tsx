import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ShoppingCart,
  DollarSign,
  CreditCard,
  Users,
  AlertTriangle,
  TrendingUp,
  Car,
  Boxes,
} from 'lucide-react'
import DashboardCharts from './dashboard-charts'

export const dynamic = 'force-dynamic'

async function getDashboardData() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const [
    { data: pedidosHoy },
    { data: comprobantesHoy },
    { data: cobrosHoy },
    { data: vendedoresActivos },
    { data: pedidosPendientes },
    { data: ultimos10Pedidos },
    { data: ventasSemana },
    { count: solicitudesPendientes },
    { data: mantenimientos },
    { data: lotesAlerta },
  ] = await Promise.all([
    supabase
      .from('pedidos')
      .select('id, total, estado')
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`),
    supabase
      .from('comprobantes')
      .select('total')
      .gte('fecha_emision', today)
      .lte('fecha_emision', today)
      .neq('estado', 'anulado'),
    supabase
      .from('cobros')
      .select('total')
      .gte('fecha', today)
      .lte('fecha', today),
    supabase
      .from('gps_checkins')
      .select('usuario_id')
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`)
      .eq('tipo', 'entrada'),
    supabase
      .from('pedidos')
      .select('id')
      .eq('estado', 'enviado'),
    supabase
      .from('pedidos')
      .select(`
        id, numero, total, estado, created_at,
        clientes(razon_social)
      `)
      .gte('created_at', `${today}T00:00:00`)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('comprobantes')
      .select('fecha_emision, total')
      .gte('fecha_emision', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .neq('estado', 'anulado')
      .order('fecha_emision', { ascending: true }),
    supabase
      .from('solicitudes_cliente' as any)
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'pendiente'),
    supabase
      .from('mantenimientos_vehiculo' as any)
      .select('id, fecha_vencimiento, estado'),
    supabase
      .from('lotes')
      .select('id, fecha_vencimiento, cantidad_actual')
      .gt('cantidad_actual', 0)
      .eq('activo', true)
      .not('fecha_vencimiento', 'is', null),
  ])

  const totalPedidos = pedidosHoy?.length ?? 0
  const totalFacturado = comprobantesHoy?.reduce((acc, c) => acc + (c.total ?? 0), 0) ?? 0
  const totalCobrado = cobrosHoy?.reduce((acc, c) => acc + ((c as any).total ?? 0), 0) ?? 0
  const clientesVisitados = new Set(vendedoresActivos?.map((v) => (v as any).usuario_id)).size
  const pedidosPendientesCount = pedidosPendientes?.length ?? 0

  // Ventas últimos 7 días
  const ventasPorDia: Record<string, number> = {}
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    ventasPorDia[d.toISOString().split('T')[0]] = 0
  }
  ventasSemana?.forEach((c) => {
    const day = c.fecha_emision
    if (ventasPorDia[day] !== undefined) {
      ventasPorDia[day] += c.total ?? 0
    }
  })

  const chartData = Object.entries(ventasPorDia).map(([date, total]) => ({
    dia: new Date(date + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric' }),
    total,
  }))

  // Alertas vehiculares (SOAT, revisión, etc.)
  const hoyDate = new Date()
  hoyDate.setHours(0, 0, 0, 0)
  const en15 = new Date(hoyDate.getTime() + 15 * 24 * 60 * 60 * 1000)

  let alertasVencidas = 0
  let alertasProximas = 0
  ;(mantenimientos ?? []).forEach((m: any) => {
    if (!m.fecha_vencimiento) return
    if (m.estado === 'cumplido' || m.estado === 'anulada') return
    const fv = new Date(m.fecha_vencimiento + 'T00:00:00')
    if (isNaN(fv.getTime())) return
    if (fv < hoyDate) alertasVencidas++
    else if (fv <= en15) alertasProximas++
  })

  // Alertas de lotes (vencidos y próximos a vencer en 30 días)
  const en30 = new Date(hoyDate.getTime() + 30 * 24 * 60 * 60 * 1000)
  let lotesVencidos = 0
  let lotesPorVencer = 0
  ;(lotesAlerta ?? []).forEach((l: any) => {
    if (!l.fecha_vencimiento) return
    if (Number(l.cantidad_actual ?? 0) <= 0) return
    const fv = new Date(l.fecha_vencimiento + 'T00:00:00')
    if (isNaN(fv.getTime())) return
    if (fv < hoyDate) lotesVencidos++
    else if (fv <= en30) lotesPorVencer++
  })

  return {
    totalPedidos,
    totalFacturado,
    totalCobrado,
    clientesVisitados,
    pedidosPendientesCount,
    solicitudesPendientesCount: solicitudesPendientes ?? 0,
    ultimos10Pedidos: ultimos10Pedidos ?? [],
    chartData,
    alertasVencidas,
    alertasProximas,
    lotesVencidos,
    lotesPorVencer,
  }
}

const ESTADO_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  borrador: { label: 'Borrador', variant: 'outline' },
  enviado: { label: 'Enviado', variant: 'default' },
  validado: { label: 'Validado', variant: 'default' },
  facturado: { label: 'Facturado', variant: 'default' },
  despachado: { label: 'Despachado', variant: 'default' },
  entregado: { label: 'Entregado', variant: 'secondary' },
  cancelado: { label: 'Cancelado', variant: 'destructive' },
}

export default async function DashboardPage() {
  const data = await getDashboardData()

  const kpis = [
    {
      title: 'Pedidos del Día',
      value: data.totalPedidos.toString(),
      icon: ShoppingCart,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      desc: 'pedidos registrados hoy',
    },
    {
      title: 'Facturado Hoy',
      value: formatCurrency(data.totalFacturado),
      icon: TrendingUp,
      color: 'text-green-600',
      bg: 'bg-green-50',
      desc: 'en comprobantes emitidos',
    },
    {
      title: 'Cobrado Hoy',
      value: formatCurrency(data.totalCobrado),
      icon: CreditCard,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
      desc: 'ingresos de caja',
    },
    {
      title: 'Clientes Visitados',
      value: data.clientesVisitados.toString(),
      icon: Users,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
      desc: 'check-ins registrados hoy',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard Gerencial</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('es-PE', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
      </div>

      {/* Alertas */}
      {data.pedidosPendientesCount > 0 && (
        <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
          <p className="text-sm text-yellow-800">
            <strong>{data.pedidosPendientesCount} pedidos</strong> pendientes de facturar.{' '}
            <a href="/facturacion" className="underline font-medium">
              Ir a Facturación →
            </a>
          </p>
        </div>
      )}

      {data.solicitudesPendientesCount > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            <strong>{data.solicitudesPendientesCount} solicitudes</strong> de nuevos clientes esperando revisión.{' '}
            <a href="/solicitudes-cliente" className="underline font-medium">
              Revisar solicitudes →
            </a>
          </p>
        </div>
      )}

      {data.alertasVencidas > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <Car className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-800">
            <strong>{data.alertasVencidas} alertas vehiculares vencidas</strong> (SOAT, revisión técnica, etc.).{' '}
            <a href="/maestros/vehiculos" className="underline font-medium">
              Ir a Vehículos →
            </a>
          </p>
        </div>
      )}

      {data.alertasProximas > 0 && (
        <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          <Car className="w-5 h-5 text-orange-500 flex-shrink-0" />
          <p className="text-sm text-orange-800">
            <strong>{data.alertasProximas} alertas vehiculares próximas a vencer</strong> (15 días o menos).{' '}
            <a href="/maestros/vehiculos" className="underline font-medium">
              Ir a Vehículos →
            </a>
          </p>
        </div>
      )}

      {data.lotesVencidos > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <Boxes className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-800">
            <strong>{data.lotesVencidos} lote{data.lotesVencidos !== 1 ? 's' : ''} vencido{data.lotesVencidos !== 1 ? 's' : ''}</strong> con stock disponible.{' '}
            <a href="/almacen/lotes" className="underline font-medium">
              Ir a Lotes →
            </a>
          </p>
        </div>
      )}

      {data.lotesPorVencer > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <Boxes className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            <strong>{data.lotesPorVencer} lote{data.lotesPorVencer !== 1 ? 's' : ''} por vencer</strong> en los próximos 30 días.{' '}
            <a href="/almacen/lotes" className="underline font-medium">
              Revisar lotes →
            </a>
          </p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title} className="border-gray-200 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{kpi.title}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{kpi.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{kpi.desc}</p>
                </div>
                <div className={`w-10 h-10 rounded-xl ${kpi.bg} flex items-center justify-center`}>
                  <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts & Table */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Gráfico de ventas */}
        <div className="xl:col-span-2">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">
                Ventas Últimos 7 Días
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DashboardCharts data={data.chartData} />
            </CardContent>
          </Card>
        </div>

        {/* Alertas rápidas */}
        <div>
          <Card className="border-gray-200 shadow-sm h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">Alertas del Sistema</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-yellow-800">Pedidos sin facturar</p>
                  <p className="text-xs text-yellow-600">{data.pedidosPendientesCount} pedidos en estado &quot;enviado&quot;</p>
                </div>
              </div>
              <a href="/caja" className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors">
                <DollarSign className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-800">Caja del día</p>
                  <p className="text-xs text-blue-600">{formatCurrency(data.totalCobrado)} cobrado hoy</p>
                </div>
              </a>
              <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-100">
                <TrendingUp className="w-4 h-4 text-green-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800">Facturación del día</p>
                  <p className="text-xs text-green-600">{formatCurrency(data.totalFacturado)} emitido</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Últimos pedidos */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-gray-800">Últimos Pedidos del Día</CardTitle>
        </CardHeader>
        <CardContent>
          {data.ultimos10Pedidos.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              No hay pedidos registrados hoy
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Número</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Hora</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.ultimos10Pedidos.map((pedido: any) => {
                    const estadoBadge = ESTADO_BADGE[pedido.estado] ?? { label: pedido.estado, variant: 'outline' }
                    return (
                      <tr key={pedido.id} className="hover:bg-gray-50 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-xs text-gray-600">{pedido.numero ?? '—'}</td>
                        <td className="py-2.5 px-3 text-gray-800 font-medium">
                          {pedido.clientes?.razon_social ?? '—'}
                        </td>
                        <td className="py-2.5 px-3 text-gray-500">
                          {new Date(pedido.created_at).toLocaleTimeString('es-PE', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'America/Lima',
                          })}
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant={estadoBadge.variant} className="text-xs">
                            {estadoBadge.label}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-gray-800">
                          {formatCurrency(pedido.total ?? 0)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
