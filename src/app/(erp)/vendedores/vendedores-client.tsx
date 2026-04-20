'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, Target, DollarSign, TrendingUp, CreditCard, Download, Eye,
  Settings, Percent, Banknote, CheckCircle2, Loader2, AlertTriangle,
  FileText, MapPin, ShoppingCart,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export interface FamiliaOption {
  id: string
  nombre: string
}

export interface MetaVendedor {
  id: string
  vendedor_id: string
  periodo: 'diaria' | 'semanal' | 'mensual'
  anio: number | null
  mes: number | null
  semana_iso: number | null
  dia: string | null
  monto_meta: number
  notas: string | null
}

export interface ReglaComision {
  id: string
  vendedor_id: string | null
  familia_id: string | null
  porcentaje: number | null
  monto_fijo: number | null
  objetivo_mensual: number | null
  activo: boolean
  es_global: boolean
}

export interface LiquidacionVendedor {
  id: string
  vendedor_id: string
  periodo_inicio: string
  periodo_fin: string
  total_ventas: number
  total_cobrado: number
  base_calculo: string | null
  porcentaje_aplicado: number | null
  monto_fijo_aplicado: number | null
  comision_calculada: number
  monto_pagado: number | null
  estado: string
  fecha_aprobacion: string | null
  fecha_pago: string | null
  caja_movimiento_id: string | null
  notas: string | null
}

export interface LiquidacionPendiente {
  id: string
  vendedor_id: string
  vendedor_nombre: string
  periodo_inicio: string
  periodo_fin: string
  total_ventas: number
  total_cobrado: number
  comision_calculada: number
  monto_pagado: number | null
  estado: string
  caja_movimiento_id: string | null
  notas: string | null
}

export interface VendedorData {
  id: string
  full_name: string
  email: string
  total_ventas: number
  total_cobrado: number
  pedidos_count: number
  clientes_visitados: number
  ventas_hoy: number
  cobrado_hoy: number
  pedidos_hoy: number
  meta: MetaVendedor | null
  regla: ReglaComision | null
  comision_calculada: number
  liquidaciones: LiquidacionVendedor[]
  pedidos_detalle: Array<{ id: string; numero: string | null; cliente_id: string | null; fecha_pedido: string; total: number; estado: string }>
  comprobantes_detalle: Array<{ id: string; fecha_emision: string; total: number; cliente_id: string | null }>
  cobros_detalle: Array<{ id: string; fecha: string; total: number; cliente_id: string | null }>
  checkins_detalle: Array<{ id: string; created_at: string; cliente_id: string | null; tipo: string | null }>
}

interface KpisGlobal {
  total_vendedores: number
  ventas_totales_mes: number
  cobros_totales_mes: number
  comisiones_pendientes_pago: number
}

function getIniciales(nombre: string) {
  return nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export default function VendedoresClient({
  vendedoresIniciales,
  familias,
  liquidacionesPendientes,
  kpis,
  anioActual,
  mesActual,
}: {
  vendedoresIniciales: VendedorData[]
  familias: FamiliaOption[]
  liquidacionesPendientes: LiquidacionPendiente[]
  kpis: KpisGlobal
  anioActual: number
  mesActual: number
}) {
  const router = useRouter()
  const supabase = createClient()

  const [saving, setSaving] = useState(false)

  // Modales
  const [metaOpen, setMetaOpen] = useState(false)
  const [reglaOpen, setReglaOpen] = useState(false)
  const [liqOpen, setLiqOpen] = useState(false)
  const [detalleOpen, setDetalleOpen] = useState(false)
  const [selected, setSelected] = useState<VendedorData | null>(null)

  // Form: Meta
  const [metaForm, setMetaForm] = useState({
    periodo: 'mensual' as 'diaria' | 'semanal' | 'mensual',
    anio: anioActual,
    mes: mesActual,
    semana_iso: getISOWeek(new Date()),
    dia: new Date().toISOString().split('T')[0],
    monto_meta: '',
    notas: '',
  })

  // Form: Regla
  const [reglaForm, setReglaForm] = useState({
    tipo: 'porc_ventas' as 'porc_ventas' | 'porc_cobrado' | 'monto_fijo',
    porcentaje: '',
    monto_fijo: '',
    objetivo_mensual: '',
    familia_id: 'ninguna',
    activo: true,
  })

  // Form: Liquidación
  const [liqForm, setLiqForm] = useState({
    periodo_inicio: new Date(anioActual, mesActual - 1, 1).toISOString().split('T')[0],
    periodo_fin: new Date().toISOString().split('T')[0],
    notas: '',
  })
  const [liqCalc, setLiqCalc] = useState({
    total_ventas: 0,
    total_cobrado: 0,
    comision: 0,
    base: 'ventas' as 'ventas' | 'cobrado' | 'fijo',
  })

  // ---------- Apertura de modales ----------

  const openMeta = (v: VendedorData) => {
    setSelected(v)
    if (v.meta) {
      setMetaForm({
        periodo: v.meta.periodo,
        anio: v.meta.anio ?? anioActual,
        mes: v.meta.mes ?? mesActual,
        semana_iso: v.meta.semana_iso ?? getISOWeek(new Date()),
        dia: v.meta.dia ?? new Date().toISOString().split('T')[0],
        monto_meta: String(v.meta.monto_meta ?? ''),
        notas: v.meta.notas ?? '',
      })
    } else {
      setMetaForm({
        periodo: 'mensual',
        anio: anioActual,
        mes: mesActual,
        semana_iso: getISOWeek(new Date()),
        dia: new Date().toISOString().split('T')[0],
        monto_meta: '',
        notas: '',
      })
    }
    setMetaOpen(true)
  }

  const openRegla = (v: VendedorData) => {
    setSelected(v)
    const r = v.regla
    if (r && !r.es_global) {
      const tipo: 'porc_ventas' | 'porc_cobrado' | 'monto_fijo' =
        r.monto_fijo && r.monto_fijo > 0 ? 'monto_fijo' : 'porc_ventas'
      setReglaForm({
        tipo,
        porcentaje: r.porcentaje ? String(r.porcentaje) : '',
        monto_fijo: r.monto_fijo ? String(r.monto_fijo) : '',
        objetivo_mensual: r.objetivo_mensual ? String(r.objetivo_mensual) : '',
        familia_id: r.familia_id ?? 'ninguna',
        activo: r.activo,
      })
    } else {
      setReglaForm({
        tipo: 'porc_ventas',
        porcentaje: '',
        monto_fijo: '',
        objetivo_mensual: '',
        familia_id: 'ninguna',
        activo: true,
      })
    }
    setReglaOpen(true)
  }

  const openLiq = async (v: VendedorData) => {
    setSelected(v)
    const inicio = new Date(anioActual, mesActual - 1, 1).toISOString().split('T')[0]
    const fin = new Date().toISOString().split('T')[0]
    setLiqForm({ periodo_inicio: inicio, periodo_fin: fin, notas: '' })
    await recalcularLiq(v, inicio, fin)
    setLiqOpen(true)
  }

  const recalcularLiq = async (v: VendedorData, inicio: string, fin: string) => {
    // Traer pedidos del vendedor en el rango + comprobantes no anulados
    const { data: pedidos } = await supabase
      .from('pedidos')
      .select('id')
      .eq('vendedor_id', v.id)
      .gte('fecha_pedido', inicio)
      .lte('fecha_pedido', fin)
    const pedidoIds = (pedidos ?? []).map((p: any) => p.id)
    let total_ventas = 0
    if (pedidoIds.length > 0) {
      const { data: comps } = await supabase
        .from('comprobantes')
        .select('total, estado')
        .in('pedido_id', pedidoIds)
        .neq('estado', 'anulado')
      total_ventas = (comps ?? []).reduce((a: number, c: any) => a + Number(c.total ?? 0), 0)
    }
    const { data: cobros } = await supabase
      .from('cobros')
      .select('total')
      .eq('cobrador_id', v.id)
      .gte('fecha', inicio)
      .lte('fecha', fin)
    const total_cobrado = (cobros ?? []).reduce((a: number, c: any) => a + Number(c.total ?? 0), 0)

    let comision = 0
    let base: 'ventas' | 'cobrado' | 'fijo' = 'ventas'
    if (v.regla) {
      const porc = Number(v.regla.porcentaje ?? 0)
      const fijo = Number(v.regla.monto_fijo ?? 0)
      if (fijo > 0) {
        comision = fijo
        base = 'fijo'
      } else if (porc > 0) {
        comision = (total_ventas * porc) / 100
        base = 'ventas'
      }
    }
    setLiqCalc({ total_ventas, total_cobrado, comision, base })
  }

  // ---------- Operaciones ----------

  const guardarMeta = async () => {
    if (!selected) return
    const monto = parseFloat(metaForm.monto_meta)
    if (!monto || monto <= 0) {
      toast.error('Monto inválido', { description: 'Ingresa un monto mayor a cero.' })
      return
    }
    setSaving(true)
    const payload: any = {
      vendedor_id: selected.id,
      periodo: metaForm.periodo,
      anio: metaForm.periodo === 'diaria' ? null : metaForm.anio,
      mes: metaForm.periodo === 'mensual' ? metaForm.mes : metaForm.periodo === 'semanal' ? metaForm.mes : null,
      semana_iso: metaForm.periodo === 'semanal' ? metaForm.semana_iso : null,
      dia: metaForm.periodo === 'diaria' ? metaForm.dia : null,
      monto_meta: monto,
      notas: metaForm.notas || null,
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.id) payload.created_by = user.id

    const { error } = await (supabase.from('metas_vendedor' as any) as any).upsert(payload, {
      onConflict: 'vendedor_id,periodo,anio,mes,semana_iso,dia',
    })
    setSaving(false)
    if (error) {
      toast.error('Error al guardar meta', { description: error.message })
      return
    }
    toast.success('Meta configurada')
    setMetaOpen(false)
    router.refresh()
  }

  const guardarRegla = async () => {
    if (!selected) return
    const porc = parseFloat(reglaForm.porcentaje) || 0
    const fijo = parseFloat(reglaForm.monto_fijo) || 0
    if (reglaForm.tipo !== 'monto_fijo' && porc <= 0) {
      toast.error('Porcentaje inválido', { description: 'Ingresa un porcentaje mayor a cero.' })
      return
    }
    if (reglaForm.tipo === 'monto_fijo' && fijo <= 0) {
      toast.error('Monto fijo inválido', { description: 'Ingresa un monto mayor a cero.' })
      return
    }
    setSaving(true)
    // Desactivar regla anterior activa del vendedor
    const { error: errDeact } = await supabase
      .from('comisiones_reglas')
      .update({ activo: false } as any)
      .eq('vendedor_id', selected.id)
      .eq('activo', true)
    if (errDeact) {
      setSaving(false)
      toast.error('Error al desactivar regla previa', { description: errDeact.message })
      return
    }
    const payload: any = {
      vendedor_id: selected.id,
      familia_id: reglaForm.familia_id === 'ninguna' ? null : reglaForm.familia_id,
      porcentaje: reglaForm.tipo === 'monto_fijo' ? null : porc,
      monto_fijo: reglaForm.tipo === 'monto_fijo' ? fijo : null,
      objetivo_mensual: reglaForm.objetivo_mensual ? parseFloat(reglaForm.objetivo_mensual) : null,
      activo: reglaForm.activo,
    }
    const { error } = await supabase.from('comisiones_reglas').insert(payload)
    setSaving(false)
    if (error) {
      toast.error('Error al crear regla', { description: error.message })
      return
    }
    toast.success('Regla de comisión creada')
    setReglaOpen(false)
    router.refresh()
  }

  const liquidarComision = async () => {
    if (!selected) return
    if (liqCalc.comision <= 0) {
      toast.error('Comisión en cero', { description: 'Configura una regla de comisión antes de liquidar.' })
      return
    }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload: any = {
      vendedor_id: selected.id,
      periodo_inicio: liqForm.periodo_inicio,
      periodo_fin: liqForm.periodo_fin,
      total_ventas: liqCalc.total_ventas,
      total_cobrado: liqCalc.total_cobrado,
      base_calculo: liqCalc.base,
      porcentaje_aplicado: selected.regla?.porcentaje ?? null,
      monto_fijo_aplicado: selected.regla?.monto_fijo ?? null,
      comision_calculada: liqCalc.comision,
      estado: 'pendiente',
      notas: liqForm.notas || null,
      created_by: user?.id ?? null,
    }
    const { error } = await (supabase.from('liquidaciones_comision' as any) as any).insert(payload)
    setSaving(false)
    if (error) {
      toast.error('Error al liquidar comisión', { description: error.message })
      return
    }
    toast.success('Liquidación creada', {
      description: `${formatCurrency(liqCalc.comision)} pendientes de aprobación`,
    })
    setLiqOpen(false)
    router.refresh()
  }

  const aprobarLiquidacion = async (l: LiquidacionPendiente) => {
    const { error } = await (supabase.from('liquidaciones_comision' as any) as any)
      .update({ estado: 'aprobada', fecha_aprobacion: new Date().toISOString() })
      .eq('id', l.id)
    if (error) {
      toast.error('Error al aprobar', { description: error.message })
      return
    }
    toast.success('Liquidación aprobada')
    router.refresh()
  }

  const marcarPagada = async (l: LiquidacionPendiente) => {
    // Verifica caja abierta
    const { data: { user } } = await supabase.auth.getUser()
    const { data: sesion } = await supabase
      .from('caja_sesiones')
      .select('id')
      .eq('estado', 'abierta')
      .limit(1)
      .maybeSingle()
    if (!sesion) {
      toast.error('Abre la caja primero antes de pagar comisiones')
      return
    }

    // Crea movimiento
    const { data: mov, error: errMov } = await supabase
      .from('caja_movimientos')
      .insert({
        sesion_id: (sesion as any).id,
        tipo: 'egreso',
        categoria: 'pago_planilla' as any,
        monto: l.comision_calculada,
        descripcion: `Pago comisión ${l.vendedor_nombre} (${formatDate(l.periodo_inicio)} - ${formatDate(l.periodo_fin)})`,
        cobrador_id: user?.id ?? null,
      } as any)
      .select('id')
      .single()
    if (errMov || !mov) {
      toast.error('Error al registrar movimiento de caja', { description: errMov?.message })
      return
    }

    const { error } = await (supabase.from('liquidaciones_comision' as any) as any)
      .update({
        estado: 'pagada',
        fecha_pago: new Date().toISOString(),
        monto_pagado: l.comision_calculada,
        pagado_por: user?.id ?? null,
        caja_movimiento_id: (mov as any).id,
      })
      .eq('id', l.id)
    if (error) {
      toast.error('Error al marcar como pagada', { description: error.message })
      return
    }
    toast.success('Comisión pagada', {
      description: `${formatCurrency(l.comision_calculada)} registrados en caja`,
    })
    router.refresh()
  }

  // ---------- Exportar CSV ----------

  const exportarCSV = () => {
    const header = [
      'Vendedor', 'Email', 'Meta del mes', 'Ventas del mes', 'Cobros del mes',
      'Pedidos', 'Clientes visitados', 'Comisión calculada',
    ]
    const rows: (string | number)[][] = [header]
    for (const v of vendedoresIniciales) {
      rows.push([
        v.full_name,
        v.email,
        v.meta?.monto_meta ?? 0,
        v.total_ventas,
        v.total_cobrado,
        v.pedidos_count,
        v.clientes_visitados,
        v.comision_calculada,
      ])
    }
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte-vendedores-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Reporte exportado')
  }

  // ---------- Cards helpers ----------

  const kpiCards = [
    {
      title: 'Vendedores activos',
      value: kpis.total_vendedores.toString(),
      desc: 'con rol vendedor',
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      title: 'Ventas del mes',
      value: formatCurrency(kpis.ventas_totales_mes),
      desc: 'facturado por la fuerza de ventas',
      icon: TrendingUp,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      title: 'Cobros del mes',
      value: formatCurrency(kpis.cobros_totales_mes),
      desc: 'ingresos aplicados',
      icon: CreditCard,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      title: 'Comisiones por pagar',
      value: formatCurrency(kpis.comisiones_pendientes_pago),
      desc: 'liquidaciones aprobadas',
      icon: DollarSign,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
  ]

  const openDetalle = (v: VendedorData) => {
    setSelected(v)
    setDetalleOpen(true)
  }

  // Gráfico de ventas por día del mes
  const ventasPorDiaChart = useMemo(() => {
    if (!selected) return []
    const map: Record<string, number> = {}
    const lastDay = new Date(anioActual, mesActual, 0).getDate()
    for (let i = 1; i <= lastDay; i++) {
      const key = `${anioActual}-${String(mesActual).padStart(2, '0')}-${String(i).padStart(2, '0')}`
      map[key] = 0
    }
    for (const c of selected.comprobantes_detalle) {
      if (map[c.fecha_emision] !== undefined) map[c.fecha_emision] += c.total
    }
    return Object.entries(map).map(([fecha, total]) => ({
      dia: fecha.split('-')[2],
      total,
    }))
  }, [selected, anioActual, mesActual])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestión de Vendedores</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Metas, ventas, comisiones y liquidaciones
          </p>
        </div>
        <Button
          onClick={exportarCSV}
          className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
        >
          <Download className="w-4 h-4" /> Exportar Reporte
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((kpi) => (
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

      {/* Grid cards por vendedor */}
      {vendedoresIniciales.length === 0 ? (
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="py-16 text-center text-gray-400 text-sm">
            No hay vendedores activos registrados
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {vendedoresIniciales.map((v) => {
            const meta = v.meta?.monto_meta ?? 0
            const pct = meta > 0 ? Math.min(100, (v.total_ventas / meta) * 100) : 0
            const tienePendiente = v.liquidaciones.some(
              (l) => l.estado === 'pendiente' || l.estado === 'aprobada'
            )
            let badgeClass = 'bg-gray-100 text-gray-700 border-gray-200'
            let badgeLabel = 'Al día'
            if (tienePendiente) {
              badgeClass = 'bg-amber-100 text-amber-700 border-amber-200'
              badgeLabel = 'Liquidación pendiente'
            } else if (meta > 0 && pct >= 100) {
              badgeClass = 'bg-green-100 text-green-700 border-green-200'
              badgeLabel = 'Meta superada'
            } else if (meta > 0 && pct >= 80) {
              badgeClass = 'bg-yellow-100 text-yellow-700 border-yellow-200'
              badgeLabel = 'Cerca de meta'
            }

            return (
              <Card key={v.id} className="border-gray-200 shadow-sm">
                <CardContent className="p-5 space-y-3">
                  {/* Header */}
                  <div className="flex items-start gap-3">
                    <Avatar className="w-11 h-11 bg-yellow-100 text-black">
                      <AvatarFallback className="bg-[#FBE600] text-black font-bold">
                        {getIniciales(v.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900 truncate">{v.full_name}</p>
                      <p className="text-xs text-gray-500 truncate">{v.email || '—'}</p>
                    </div>
                    <Badge className={`text-[10px] shrink-0 ${badgeClass}`}>{badgeLabel}</Badge>
                  </div>

                  {/* Progreso vs meta */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-500">Progreso meta mensual</span>
                      {meta > 0 ? (
                        <span className="font-semibold text-gray-800">
                          {pct.toFixed(0)}% · {formatCurrency(v.total_ventas)} / {formatCurrency(meta)}
                        </span>
                      ) : (
                        <span className="text-gray-400">Sin meta configurada</span>
                      )}
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#FBE600] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Mini-stats */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded bg-gray-50">
                      <p className="text-gray-400">Ventas del mes</p>
                      <p className="font-semibold text-gray-800">{formatCurrency(v.total_ventas)}</p>
                    </div>
                    <div className="p-2 rounded bg-gray-50">
                      <p className="text-gray-400">Cobros del mes</p>
                      <p className="font-semibold text-gray-800">{formatCurrency(v.total_cobrado)}</p>
                    </div>
                    <div className="p-2 rounded bg-gray-50">
                      <p className="text-gray-400">Pedidos del mes</p>
                      <p className="font-semibold text-gray-800">{v.pedidos_count}</p>
                    </div>
                    <div className="p-2 rounded bg-gray-50">
                      <p className="text-gray-400">Clientes visitados</p>
                      <p className="font-semibold text-gray-800">{v.clientes_visitados}</p>
                    </div>
                  </div>

                  {/* Comisión */}
                  <div className="flex items-center justify-between p-2 rounded bg-yellow-50 border border-yellow-200 text-xs">
                    <span className="text-gray-700">
                      {v.regla
                        ? v.regla.monto_fijo
                          ? `Monto fijo mensual`
                          : `${v.regla.porcentaje}% s/ventas${v.regla.es_global ? ' (global)' : ''}`
                        : 'Sin regla configurada'}
                    </span>
                    <span className="font-bold text-gray-900">
                      {formatCurrency(v.comision_calculada)}
                    </span>
                  </div>

                  {/* Botones */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" onClick={() => openMeta(v)} className="text-xs gap-1">
                      <Target className="w-3.5 h-3.5" /> Meta
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openRegla(v)} className="text-xs gap-1">
                      <Percent className="w-3.5 h-3.5" /> Comisión
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => openLiq(v)}
                      className="text-xs gap-1 bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold"
                    >
                      <Banknote className="w-3.5 h-3.5" /> Liquidar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openDetalle(v)} className="text-xs gap-1">
                      <Eye className="w-3.5 h-3.5" /> Detalle
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Tabla de liquidaciones pendientes */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-gray-800">
            Liquidaciones
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {liquidacionesPendientes.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              No hay liquidaciones registradas
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Vendedor', 'Periodo', 'Ventas', 'Cobrado', 'Comisión', 'Estado', 'Acciones'].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {liquidacionesPendientes.map((l) => {
                    let badgeClass = 'bg-gray-100 text-gray-700 border-gray-200'
                    let badgeLabel = l.estado
                    if (l.estado === 'pendiente') {
                      badgeClass = 'bg-yellow-100 text-yellow-700 border-yellow-200'
                      badgeLabel = 'Pendiente'
                    } else if (l.estado === 'aprobada') {
                      badgeClass = 'bg-blue-100 text-blue-700 border-blue-200'
                      badgeLabel = 'Aprobada'
                    } else if (l.estado === 'pagada') {
                      badgeClass = 'bg-green-100 text-green-700 border-green-200'
                      badgeLabel = 'Pagada'
                    } else if (l.estado === 'anulada') {
                      badgeClass = 'bg-red-100 text-red-700 border-red-200'
                      badgeLabel = 'Anulada'
                    }
                    return (
                      <tr key={l.id} className="hover:bg-gray-50/50">
                        <td className="py-3 px-4 font-medium text-gray-800">{l.vendedor_nombre}</td>
                        <td className="py-3 px-4 text-xs text-gray-600">
                          {formatDate(l.periodo_inicio)} — {formatDate(l.periodo_fin)}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-700">{formatCurrency(l.total_ventas)}</td>
                        <td className="py-3 px-4 text-xs text-green-600">{formatCurrency(l.total_cobrado)}</td>
                        <td className="py-3 px-4 font-bold text-gray-900">{formatCurrency(l.comision_calculada)}</td>
                        <td className="py-3 px-4">
                          <Badge className={`text-[10px] ${badgeClass}`}>{badgeLabel}</Badge>
                        </td>
                        <td className="py-3 px-4">
                          {l.estado === 'pendiente' && (
                            <Button size="sm" variant="outline" onClick={() => aprobarLiquidacion(l)} className="h-7 text-xs">
                              Aprobar
                            </Button>
                          )}
                          {l.estado === 'aprobada' && (
                            <Button
                              size="sm"
                              onClick={() => marcarPagada(l)}
                              className="h-7 text-xs bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold"
                            >
                              Marcar Pagada
                            </Button>
                          )}
                          {l.estado === 'pagada' && (
                            <span className="text-xs text-green-600 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Pagada
                            </span>
                          )}
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

      {/* --- Modal: Configurar Meta --- */}
      <Dialog open={metaOpen} onOpenChange={setMetaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configurar Meta</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="p-3 rounded bg-gray-50 text-sm">
                <p className="text-xs text-gray-500">Vendedor</p>
                <p className="font-semibold">{selected.full_name}</p>
              </div>
              <div>
                <Label>Periodo</Label>
                <Select value={metaForm.periodo} onValueChange={(v) => setMetaForm((p) => ({ ...p, periodo: v as any }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="diaria">Diaria</SelectItem>
                    <SelectItem value="semanal">Semanal</SelectItem>
                    <SelectItem value="mensual">Mensual</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {metaForm.periodo === 'diaria' && (
                <div>
                  <Label>Día</Label>
                  <Input
                    type="date"
                    value={metaForm.dia}
                    onChange={(e) => setMetaForm((p) => ({ ...p, dia: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              )}

              {metaForm.periodo !== 'diaria' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Año</Label>
                    <Input
                      type="number"
                      value={metaForm.anio}
                      onChange={(e) => setMetaForm((p) => ({ ...p, anio: parseInt(e.target.value) || anioActual }))}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Mes</Label>
                    <Input
                      type="number" min={1} max={12}
                      value={metaForm.mes}
                      onChange={(e) => setMetaForm((p) => ({ ...p, mes: parseInt(e.target.value) || mesActual }))}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}

              {metaForm.periodo === 'semanal' && (
                <div>
                  <Label>Semana ISO</Label>
                  <Input
                    type="number" min={1} max={53}
                    value={metaForm.semana_iso}
                    onChange={(e) => setMetaForm((p) => ({ ...p, semana_iso: parseInt(e.target.value) || 1 }))}
                    className="mt-1"
                  />
                </div>
              )}

              <div>
                <Label>Monto meta (S/)</Label>
                <Input
                  type="number" step="0.01" min={0}
                  value={metaForm.monto_meta}
                  onChange={(e) => setMetaForm((p) => ({ ...p, monto_meta: e.target.value }))}
                  className="mt-1"
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Notas</Label>
                <Textarea
                  value={metaForm.notas}
                  onChange={(e) => setMetaForm((p) => ({ ...p, notas: e.target.value }))}
                  className="mt-1"
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setMetaOpen(false)}>Cancelar</Button>
                <Button
                  onClick={guardarMeta}
                  disabled={saving}
                  className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} Guardar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* --- Modal: Regla de Comisión --- */}
      <Dialog open={reglaOpen} onOpenChange={setReglaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Regla de Comisión</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="p-3 rounded bg-gray-50 text-sm">
                <p className="text-xs text-gray-500">Vendedor</p>
                <p className="font-semibold">{selected.full_name}</p>
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={reglaForm.tipo} onValueChange={(v) => setReglaForm((p) => ({ ...p, tipo: v as any }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="porc_ventas">Porcentaje sobre ventas</SelectItem>
                    <SelectItem value="porc_cobrado">Porcentaje sobre cobrado</SelectItem>
                    <SelectItem value="monto_fijo">Monto fijo mensual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {reglaForm.tipo !== 'monto_fijo' ? (
                <div>
                  <Label>Porcentaje (%)</Label>
                  <Input
                    type="number" step="0.01" min={0}
                    value={reglaForm.porcentaje}
                    onChange={(e) => setReglaForm((p) => ({ ...p, porcentaje: e.target.value }))}
                    className="mt-1"
                    placeholder="0.00"
                  />
                </div>
              ) : (
                <div>
                  <Label>Monto fijo (S/)</Label>
                  <Input
                    type="number" step="0.01" min={0}
                    value={reglaForm.monto_fijo}
                    onChange={(e) => setReglaForm((p) => ({ ...p, monto_fijo: e.target.value }))}
                    className="mt-1"
                    placeholder="0.00"
                  />
                </div>
              )}
              <div>
                <Label>Objetivo mensual (opcional)</Label>
                <Input
                  type="number" step="0.01" min={0}
                  value={reglaForm.objetivo_mensual}
                  onChange={(e) => setReglaForm((p) => ({ ...p, objetivo_mensual: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Familia (opcional)</Label>
                <Select value={reglaForm.familia_id} onValueChange={(v) => setReglaForm((p) => ({ ...p, familia_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ninguna">Todas las familias</SelectItem>
                    {familias.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="activo"
                  checked={reglaForm.activo}
                  onChange={(e) => setReglaForm((p) => ({ ...p, activo: e.target.checked }))}
                />
                <Label htmlFor="activo" className="cursor-pointer">Activo</Label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setReglaOpen(false)}>Cancelar</Button>
                <Button
                  onClick={guardarRegla}
                  disabled={saving}
                  className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} Guardar Regla
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* --- Modal: Liquidar Comisión --- */}
      <Dialog open={liqOpen} onOpenChange={setLiqOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Liquidar Comisión</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="p-3 rounded bg-gray-50 text-sm">
                <p className="text-xs text-gray-500">Vendedor</p>
                <p className="font-semibold">{selected.full_name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {selected.regla
                    ? selected.regla.monto_fijo
                      ? `Monto fijo: ${formatCurrency(selected.regla.monto_fijo)}`
                      : `${selected.regla.porcentaje}% sobre ventas`
                    : 'Sin regla configurada'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Desde</Label>
                  <Input
                    type="date"
                    value={liqForm.periodo_inicio}
                    onChange={async (e) => {
                      const val = e.target.value
                      setLiqForm((p) => ({ ...p, periodo_inicio: val }))
                      if (selected) await recalcularLiq(selected, val, liqForm.periodo_fin)
                    }}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Hasta</Label>
                  <Input
                    type="date"
                    value={liqForm.periodo_fin}
                    onChange={async (e) => {
                      const val = e.target.value
                      setLiqForm((p) => ({ ...p, periodo_fin: val }))
                      if (selected) await recalcularLiq(selected, liqForm.periodo_inicio, val)
                    }}
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-2 rounded bg-gray-50">
                  <p className="text-xs text-gray-500">Total ventas</p>
                  <p className="font-semibold">{formatCurrency(liqCalc.total_ventas)}</p>
                </div>
                <div className="p-2 rounded bg-gray-50">
                  <p className="text-xs text-gray-500">Total cobrado</p>
                  <p className="font-semibold">{formatCurrency(liqCalc.total_cobrado)}</p>
                </div>
              </div>
              <div className="p-3 rounded bg-yellow-50 border border-yellow-200 flex items-center justify-between">
                <span className="text-sm font-medium">Comisión calculada</span>
                <span className="text-lg font-bold">{formatCurrency(liqCalc.comision)}</span>
              </div>
              <div>
                <Label>Notas</Label>
                <Textarea
                  value={liqForm.notas}
                  onChange={(e) => setLiqForm((p) => ({ ...p, notas: e.target.value }))}
                  className="mt-1"
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setLiqOpen(false)}>Cancelar</Button>
                <Button
                  onClick={liquidarComision}
                  disabled={saving || liqCalc.comision <= 0}
                  className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} Generar Liquidación
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* --- Modal: Ver Detalle --- */}
      <Dialog open={detalleOpen} onOpenChange={setDetalleOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del vendedor</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="w-12 h-12">
                  <AvatarFallback className="bg-[#FBE600] text-black font-bold">
                    {getIniciales(selected.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-gray-900">{selected.full_name}</p>
                  <p className="text-xs text-gray-500">{selected.email}</p>
                </div>
              </div>

              <Card className="border-gray-200 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Ventas por día del mes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={ventasPorDiaChart}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          formatter={(v: any) => formatCurrency(Number(v))}
                          labelFormatter={(l) => `Día ${l}`}
                        />
                        <Area
                          type="monotone"
                          dataKey="total"
                          stroke="#FBE600"
                          fill="#FBE600"
                          fillOpacity={0.35}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Tabs defaultValue="ventas">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="ventas"><FileText className="w-3.5 h-3.5 mr-1" />Ventas</TabsTrigger>
                  <TabsTrigger value="cobros"><DollarSign className="w-3.5 h-3.5 mr-1" />Cobros</TabsTrigger>
                  <TabsTrigger value="pedidos"><ShoppingCart className="w-3.5 h-3.5 mr-1" />Pedidos</TabsTrigger>
                  <TabsTrigger value="checkins"><MapPin className="w-3.5 h-3.5 mr-1" />Check-ins</TabsTrigger>
                </TabsList>
                <TabsContent value="ventas">
                  <DetalleLista
                    items={selected.comprobantes_detalle.map((c) => ({
                      fecha: c.fecha_emision,
                      desc: `Comprobante · cliente ${c.cliente_id?.slice(0, 8) ?? '—'}`,
                      monto: c.total,
                    }))}
                  />
                </TabsContent>
                <TabsContent value="cobros">
                  <DetalleLista
                    items={selected.cobros_detalle.map((c) => ({
                      fecha: c.fecha,
                      desc: `Cobro · cliente ${c.cliente_id?.slice(0, 8) ?? '—'}`,
                      monto: c.total,
                    }))}
                  />
                </TabsContent>
                <TabsContent value="pedidos">
                  <DetalleLista
                    items={selected.pedidos_detalle.map((p) => ({
                      fecha: p.fecha_pedido,
                      desc: `Pedido ${p.numero ?? '—'} · ${p.estado}`,
                      monto: p.total,
                    }))}
                  />
                </TabsContent>
                <TabsContent value="checkins">
                  <DetalleLista
                    items={selected.checkins_detalle.map((c) => ({
                      fecha: c.created_at.split('T')[0],
                      desc: `Check-in · cliente ${c.cliente_id?.slice(0, 8) ?? '—'}`,
                      monto: 0,
                    }))}
                    ocultarMonto
                  />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DetalleLista({
  items,
  ocultarMonto = false,
}: {
  items: Array<{ fecha: string; desc: string; monto: number }>
  ocultarMonto?: boolean
}) {
  if (items.length === 0) {
    return <div className="text-center text-sm text-gray-400 py-8">Sin registros</div>
  }
  return (
    <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <th className="text-left py-2 px-3 font-semibold text-gray-500 uppercase">Fecha</th>
            <th className="text-left py-2 px-3 font-semibold text-gray-500 uppercase">Descripción</th>
            {!ocultarMonto && <th className="text-right py-2 px-3 font-semibold text-gray-500 uppercase">Monto</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {items.map((it, i) => (
            <tr key={i} className="hover:bg-gray-50/50">
              <td className="py-2 px-3 text-gray-600">{formatDate(it.fecha)}</td>
              <td className="py-2 px-3 text-gray-700">{it.desc}</td>
              {!ocultarMonto && (
                <td className="py-2 px-3 text-right font-semibold text-gray-800">{formatCurrency(it.monto)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
