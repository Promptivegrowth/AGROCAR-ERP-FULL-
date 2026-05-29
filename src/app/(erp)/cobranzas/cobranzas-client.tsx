'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Loader2, CreditCard, DollarSign, AlertTriangle, Users, CheckCircle2,
  Landmark, Eye, Phone, FileText, Banknote, Smartphone, Building2, StickyNote,
  Send, MessageCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { linkEnviarBoletaPago, esTelefonoPeruanoValido } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

export type EstadoDeuda = 'al_dia' | 'por_vencer' | 'vencida_leve' | 'vencida_grave'

export interface ClienteSaldo {
  id: string
  razon_social: string
  ruc: string | null
  dni: string | null
  telefono: string | null
  credito_dias: number
  credito_limite: number
  estado: string
  facturado: number
  cobrado: number
  saldo: number
  dias_transcurridos: number
  estado_deuda: EstadoDeuda
  comprobantes: any[]
  cobros: any[]
}

interface Kpis {
  cuentasPorCobrarTotal: number
  deudaVencida: number
  clientesConDeuda: number
  clientesAlDia: number
  vencidosMas30: number
  cercaLimite: number
}

const ESTADO_BADGE: Record<EstadoDeuda, { label: string; className: string }> = {
  al_dia: { label: 'Al día', className: 'bg-green-100 text-green-700 border-green-200' },
  por_vencer: { label: 'Por vencer', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  vencida_leve: { label: 'Vencida <7d', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  vencida_grave: { label: 'Vencida >30d', className: 'bg-red-100 text-red-700 border-red-200' },
}

export default function CobranzasClient({
  clientesIniciales,
  kpis,
}: {
  clientesIniciales: ClienteSaldo[]
  kpis: Kpis
}) {
  const router = useRouter()
  const supabase = createClient()

  const [search, setSearch] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoDeuda>('todos')

  const [detailOpen, setDetailOpen] = useState(false)
  const [pagoOpen, setPagoOpen] = useState(false)
  const [selected, setSelected] = useState<ClienteSaldo | null>(null)
  const [saving, setSaving] = useState(false)

  // Último cobro registrado — para el dialog "Enviar por WhatsApp"
  const [enviarOpen, setEnviarOpen] = useState(false)
  const [ultimoCobro, setUltimoCobro] = useState<{
    id: string
    total: number
    cliente: string
    telefono: string | null
  } | null>(null)

  // Form de pago
  const [pago, setPago] = useState({
    fecha: new Date().toISOString().split('T')[0],
    efectivo: '',
    yape: '',
    plin: '',
    transferencia: '',
    nro_operacion: '',
    notas: '',
  })

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clientesIniciales.filter((c) => {
      if (filtroEstado !== 'todos' && c.estado_deuda !== filtroEstado) return false
      if (q) {
        const matchNombre = c.razon_social.toLowerCase().includes(q)
        const matchRuc = (c.ruc ?? '').toLowerCase().includes(q)
        const matchDni = (c.dni ?? '').toLowerCase().includes(q)
        if (!matchNombre && !matchRuc && !matchDni) return false
      }
      return true
    })
  }, [clientesIniciales, search, filtroEstado])

  const openDetail = (c: ClienteSaldo) => {
    setSelected(c)
    setDetailOpen(true)
  }

  const openPago = (c: ClienteSaldo) => {
    setSelected(c)
    setPago({
      fecha: new Date().toISOString().split('T')[0],
      efectivo: '',
      yape: '',
      plin: '',
      transferencia: '',
      nro_operacion: '',
      notas: '',
    })
    setPagoOpen(true)
  }

  const totalPago = useMemo(() => {
    const ef = parseFloat(pago.efectivo) || 0
    const y = parseFloat(pago.yape) || 0
    const p = parseFloat(pago.plin) || 0
    const t = parseFloat(pago.transferencia) || 0
    return ef + y + p + t
  }, [pago])

  const registrarPago = async () => {
    if (!selected) return
    if (totalPago <= 0) {
      toast.error('Monto inválido', { description: 'Ingresa al menos un método de pago.' })
      return
    }
    const yapePlinTrans = (parseFloat(pago.yape) || 0) + (parseFloat(pago.plin) || 0) + (parseFloat(pago.transferencia) || 0)
    if (yapePlinTrans > 0 && !pago.nro_operacion.trim()) {
      toast.error('Nro. de operación requerido', {
        description: 'Yape, Plin y Transferencia requieren el código de operación para conciliación.',
      })
      return
    }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: cobroData, error } = await (supabase as any).from('cobros').insert({
      cliente_id: selected.id,
      cobrador_id: user?.id ?? null,
      tipo: 'cobranza' as const,
      fecha: pago.fecha,
      efectivo: parseFloat(pago.efectivo) || 0,
      yape: parseFloat(pago.yape) || 0,
      plin: parseFloat(pago.plin) || 0,
      transferencia: parseFloat(pago.transferencia) || 0,
      total: totalPago,
      nro_operacion: pago.nro_operacion.trim() || null,
      notas: pago.notas || null,
    }).select('id').single()
    setSaving(false)
    if (error || !cobroData) {
      toast.error('Error al registrar pago', { description: error?.message ?? 'No se pudo registrar el cobro' })
      return
    }
    toast.success('Pago registrado', {
      description: `${formatCurrency(totalPago)} aplicados a ${selected.razon_social}`,
    })
    // Cierra el form, pero NO el detalle — abrimos dialog de envío
    setPagoOpen(false)
    setUltimoCobro({
      id: cobroData.id,
      total: totalPago,
      cliente: selected.razon_social,
      telefono: selected.telefono,
    })
    setEnviarOpen(true)
    router.refresh()
  }

  const kpiCards = [
    {
      title: 'Cuentas por Cobrar',
      value: formatCurrency(kpis.cuentasPorCobrarTotal),
      desc: 'saldo total pendiente',
      icon: Landmark,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      title: 'Deuda Vencida',
      value: formatCurrency(kpis.deudaVencida),
      desc: 'fuera de plazo',
      icon: AlertTriangle,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      title: 'Clientes con Deuda',
      value: kpis.clientesConDeuda.toString(),
      desc: 'saldo > 0',
      icon: Users,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      title: 'Clientes al Día',
      value: kpis.clientesAlDia.toString(),
      desc: 'sin deuda o dentro de plazo',
      icon: CheckCircle2,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cobranzas</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestión de créditos y cuentas por cobrar</p>
        </div>
      </div>

      {/* Alertas */}
      {(kpis.vencidosMas30 > 0 || kpis.cercaLimite > 0) && (
        <div className="space-y-2">
          {kpis.vencidosMas30 > 0 && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-700">
                <strong>{kpis.vencidosMas30} clientes</strong> tienen deuda vencida a más de 30 días.
              </p>
            </div>
          )}
          {kpis.cercaLimite > 0 && (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-700">
                <strong>{kpis.cercaLimite} clientes</strong> están al 90% o más de su límite de crédito.
              </p>
            </div>
          )}
        </div>
      )}

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

      {/* Filtros */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Buscar por razón social, RUC o DNI..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={filtroEstado} onValueChange={(v) => setFiltroEstado(v as any)}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              <SelectItem value="al_dia">Al día</SelectItem>
              <SelectItem value="por_vencer">Por vencer</SelectItem>
              <SelectItem value="vencida_leve">Vencida (&lt;7d)</SelectItem>
              <SelectItem value="vencida_grave">Vencida (&gt;30d)</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {filtrados.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <CreditCard className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No hay clientes que coincidan</p>
            </div>
          ) : (
            <>
              {/* Vista móvil: cards */}
              <div className="md:hidden divide-y divide-gray-50">
                {filtrados.map((c) => {
                  const badge = ESTADO_BADGE[c.estado_deuda]
                  return (
                    <div key={c.id} className="p-4 hover:bg-gray-50/50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">{c.razon_social}</p>
                          <p className="text-xs text-gray-500 font-mono">{c.ruc ?? 'Sin RUC'}</p>
                        </div>
                        <Badge className={`text-xs shrink-0 ${badge.className}`}>{badge.label}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                        <div>
                          <p className="text-gray-400">Saldo</p>
                          <p className={`font-bold ${c.saldo > 0 ? 'text-red-600' : 'text-gray-700'}`}>
                            {formatCurrency(c.saldo)}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-400">Días transc.</p>
                          <p className="font-medium text-gray-700">{c.dias_transcurridos} / {c.credito_dias}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 mt-3">
                        <Button variant="outline" size="sm" onClick={() => openDetail(c)} className="h-7 text-xs gap-1">
                          <Eye className="w-3.5 h-3.5" /> Ver
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => openPago(c)}
                          className="h-7 text-xs gap-1 bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold"
                        >
                          <DollarSign className="w-3.5 h-3.5" /> Pagar
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Vista desktop: tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {[
                        'Cliente', 'RUC', 'Límite', 'Días crédito', 'Facturado', 'Cobrado',
                        'Saldo', 'Días transc.', 'Estado', 'Acciones',
                      ].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtrados.map((c) => {
                      const badge = ESTADO_BADGE[c.estado_deuda]
                      const vencido = c.estado_deuda === 'vencida_leve' || c.estado_deuda === 'vencida_grave'
                      return (
                        <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-3 px-4 font-medium text-gray-900 max-w-[220px] truncate">{c.razon_social}</td>
                          <td className="py-3 px-4 text-gray-500 font-mono text-xs">{c.ruc ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs">{formatCurrency(c.credito_limite)}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs text-center">{c.credito_dias}</td>
                          <td className="py-3 px-4 text-gray-700 text-xs">{formatCurrency(c.facturado)}</td>
                          <td className="py-3 px-4 text-green-600 text-xs">{formatCurrency(c.cobrado)}</td>
                          <td className={`py-3 px-4 font-bold ${c.saldo > 0 ? (vencido ? 'text-red-600' : 'text-gray-800') : 'text-gray-400'}`}>
                            {formatCurrency(c.saldo)}
                          </td>
                          <td className="py-3 px-4 text-xs text-gray-600">
                            {c.saldo > 0 ? `${c.dias_transcurridos} / ${c.credito_dias}` : '—'}
                          </td>
                          <td className="py-3 px-4">
                            <Badge className={`text-xs ${badge.className}`}>{badge.label}</Badge>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openDetail(c)} className="h-7 w-7 p-0" title="Ver detalle">
                                <Eye className="w-3.5 h-3.5 text-gray-500" />
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => openPago(c)}
                                className="h-7 text-xs gap-1 bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold"
                                title="Registrar pago"
                              >
                                <DollarSign className="w-3.5 h-3.5" /> Pago
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dialog Detalle Cliente */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle de Cobranza</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-5 mt-2">
              {/* Datos cliente */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-4 border-b border-gray-100">
                <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center shrink-0">
                  <Landmark className="w-6 h-6 text-purple-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900">{selected.razon_social}</p>
                  <p className="text-xs text-gray-500 font-mono">{selected.ruc ?? 'Sin RUC'}</p>
                  {selected.telefono && (
                    <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {selected.telefono}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-gray-400">Límite crédito</p>
                    <p className="font-semibold text-gray-800">{formatCurrency(selected.credito_limite)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Días crédito</p>
                    <p className="font-semibold text-gray-800">{selected.credito_dias} días</p>
                  </div>
                </div>
              </div>

              {/* Resumen saldo */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                  <p className="text-xs text-gray-500">Facturado</p>
                  <p className="text-lg font-bold text-gray-800">{formatCurrency(selected.facturado)}</p>
                </div>
                <div className="p-3 rounded-lg bg-green-50 border border-green-100">
                  <p className="text-xs text-green-700">Cobrado</p>
                  <p className="text-lg font-bold text-green-700">{formatCurrency(selected.cobrado)}</p>
                </div>
                <div className={`p-3 rounded-lg border ${selected.saldo > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
                  <p className={`text-xs ${selected.saldo > 0 ? 'text-red-700' : 'text-gray-500'}`}>Saldo pendiente</p>
                  <p className={`text-lg font-bold ${selected.saldo > 0 ? 'text-red-600' : 'text-gray-800'}`}>
                    {formatCurrency(selected.saldo)}
                  </p>
                </div>
              </div>

              {/* Comprobantes emitidos */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-800">
                    Comprobantes emitidos ({selected.comprobantes.length})
                  </h3>
                </div>
                {selected.comprobantes.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Sin comprobantes</p>
                ) : (
                  <div className="overflow-x-auto border border-gray-100 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          {['Fecha', 'Serie-Número', 'Total', 'Vencimiento', 'Días transc.', 'Estado'].map((h) => (
                            <th key={h} className="text-left py-2 px-3 font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {selected.comprobantes.map((comp: any) => {
                          const fechaEmi = new Date(comp.fecha_emision + 'T00:00:00')
                          const vencimiento = new Date(fechaEmi)
                          vencimiento.setDate(vencimiento.getDate() + selected.credito_dias)
                          const hoy = new Date()
                          hoy.setHours(0, 0, 0, 0)
                          const diasT = Math.floor((hoy.getTime() - fechaEmi.getTime()) / (1000 * 60 * 60 * 24))
                          const vencido = hoy > vencimiento
                          return (
                            <tr key={comp.id} className="hover:bg-gray-50/50">
                              <td className="py-2 px-3 text-gray-600">{formatDate(comp.fecha_emision)}</td>
                              <td className="py-2 px-3 font-mono text-gray-700">
                                {comp.serie ?? '—'}-{comp.numero ?? '—'}
                              </td>
                              <td className="py-2 px-3 font-semibold text-gray-800">{formatCurrency(comp.total ?? 0)}</td>
                              <td className="py-2 px-3 text-gray-600">{formatDate(vencimiento)}</td>
                              <td className="py-2 px-3 text-gray-600">{diasT}</td>
                              <td className="py-2 px-3">
                                {vencido ? (
                                  <Badge className="text-[10px] bg-red-100 text-red-700 border-red-200">Vencido</Badge>
                                ) : (
                                  <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200">Al día</Badge>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Cobros aplicados */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-800">
                    Pagos aplicados ({selected.cobros.length})
                  </h3>
                </div>
                {selected.cobros.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Sin pagos aplicados</p>
                ) : (
                  <div className="overflow-x-auto border border-gray-100 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          {['Fecha', 'Total', 'Efectivo', 'Yape', 'Plin', 'Transf.', 'Notas'].map((h) => (
                            <th key={h} className="text-left py-2 px-3 font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {selected.cobros.map((cb: any) => {
                          const tieneNota = cb.notas && String(cb.notas).trim().length > 0
                          return (
                            <tr key={cb.id} className="hover:bg-gray-50/50">
                              <td className="py-2 px-3 text-gray-600">{formatDate(cb.fecha)}</td>
                              <td className="py-2 px-3 font-bold text-green-600">{formatCurrency(cb.total ?? 0)}</td>
                              <td className="py-2 px-3 text-gray-600">{formatCurrency(cb.efectivo ?? 0)}</td>
                              <td className="py-2 px-3 text-gray-600">{formatCurrency(cb.yape ?? 0)}</td>
                              <td className="py-2 px-3 text-gray-600">{formatCurrency(cb.plin ?? 0)}</td>
                              <td className="py-2 px-3 text-gray-600">{formatCurrency(cb.transferencia ?? 0)}</td>
                              <td className="py-2 px-3 max-w-[200px]">
                                {tieneNota ? (
                                  <div
                                    className="flex items-start gap-1 text-amber-800"
                                    title={cb.notas}
                                  >
                                    <StickyNote className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                                    <span className="truncate">{cb.notas}</span>
                                  </div>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-3 border-t border-gray-100">
                <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>
                <Button
                  onClick={() => { openPago(selected) }}
                  className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
                >
                  <DollarSign className="w-4 h-4" /> Registrar Pago
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog Registrar Pago */}
      <Dialog open={pagoOpen} onOpenChange={setPagoOpen}>
        <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar Pago</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <p className="text-xs text-gray-500">Cliente</p>
                <p className="font-semibold text-gray-900 truncate">{selected.razon_social}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Saldo pendiente:{' '}
                  <strong className={selected.saldo > 0 ? 'text-red-600' : 'text-gray-700'}>
                    {formatCurrency(selected.saldo)}
                  </strong>
                </p>
              </div>

              <div>
                <Label>Fecha</Label>
                <Input
                  type="date"
                  value={pago.fecha}
                  onChange={(e) => setPago((p) => ({ ...p, fecha: e.target.value }))}
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="flex items-center gap-1">
                    <Banknote className="w-3.5 h-3.5 text-green-600" /> Efectivo
                  </Label>
                  <Input
                    type="number" step="0.01" min={0} placeholder="0.00"
                    value={pago.efectivo}
                    onChange={(e) => setPago((p) => ({ ...p, efectivo: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="flex items-center gap-1">
                    <Smartphone className="w-3.5 h-3.5 text-purple-600" /> Yape
                  </Label>
                  <Input
                    type="number" step="0.01" min={0} placeholder="0.00"
                    value={pago.yape}
                    onChange={(e) => setPago((p) => ({ ...p, yape: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="flex items-center gap-1">
                    <Smartphone className="w-3.5 h-3.5 text-blue-600" /> Plin
                  </Label>
                  <Input
                    type="number" step="0.01" min={0} placeholder="0.00"
                    value={pago.plin}
                    onChange={(e) => setPago((p) => ({ ...p, plin: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-orange-600" /> Transferencia
                  </Label>
                  <Input
                    type="number" step="0.01" min={0} placeholder="0.00"
                    value={pago.transferencia}
                    onChange={(e) => setPago((p) => ({ ...p, transferencia: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              </div>

              {((parseFloat(pago.yape) || 0) + (parseFloat(pago.plin) || 0) + (parseFloat(pago.transferencia) || 0)) > 0 && (
                <div>
                  <Label className="flex items-center gap-1">
                    Nro. de operación
                    <span className="text-red-500">*</span>
                    <span className="text-[10px] text-gray-400 font-normal">(para conciliación bancaria)</span>
                  </Label>
                  <Input
                    placeholder="Ej. 0123456789 — código mostrado en el voucher"
                    value={pago.nro_operacion}
                    onChange={(e) => setPago((p) => ({ ...p, nro_operacion: e.target.value }))}
                    className="mt-1 font-mono"
                  />
                </div>
              )}

              <div className="flex items-center justify-between p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                <span className="text-sm font-medium text-gray-800">Total del pago</span>
                <span className="text-lg font-bold text-gray-900">{formatCurrency(totalPago)}</span>
              </div>

              <div>
                <Label>Notas</Label>
                <Input
                  placeholder="Referencia, observación..."
                  value={pago.notas}
                  onChange={(e) => setPago((p) => ({ ...p, notas: e.target.value }))}
                  className="mt-1"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <Button variant="outline" onClick={() => setPagoOpen(false)}>Cancelar</Button>
                <Button
                  onClick={registrarPago}
                  disabled={saving || totalPago <= 0}
                  className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirmar Pago
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: enviar comprobante por WhatsApp después de cobrar */}
      <Dialog open={enviarOpen} onOpenChange={(o) => { setEnviarOpen(o); if (!o) setUltimoCobro(null) }}>
        <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              Pago registrado
            </DialogTitle>
          </DialogHeader>
          {ultimoCobro && (() => {
            const telOk = esTelefonoPeruanoValido(ultimoCobro.telefono)
            const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
            const waLink = telOk
              ? linkEnviarBoletaPago({
                  baseUrl,
                  cobroId: ultimoCobro.id,
                  clienteNombre: ultimoCobro.cliente,
                  total: ultimoCobro.total,
                  telefonoCliente: ultimoCobro.telefono!,
                })
              : null
            return (
              <div className="space-y-4 mt-2">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-sm text-gray-700">Cliente</p>
                  <p className="font-semibold text-gray-900">{ultimoCobro.cliente}</p>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-green-200">
                    <span className="text-xs text-gray-600">Monto cobrado</span>
                    <span className="text-lg font-bold text-green-700">{formatCurrency(ultimoCobro.total)}</span>
                  </div>
                </div>

                {telOk && waLink ? (
                  <>
                    <p className="text-sm text-gray-700">
                      Envía el comprobante interno del pago al cliente por WhatsApp.
                    </p>
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1FB659] text-white font-semibold rounded-lg px-4 py-3 text-sm w-full transition-colors"
                      onClick={() => { setEnviarOpen(false); setUltimoCobro(null); setDetailOpen(false) }}
                    >
                      <Send className="w-4 h-4" /> Enviar comprobante por WhatsApp
                    </a>
                    <a
                      href={`/boleta/${ultimoCobro.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 text-sm text-gray-700 hover:text-gray-900 border border-gray-200 rounded-lg px-4 py-2.5 w-full"
                    >
                      <FileText className="w-4 h-4" /> Ver comprobante interno
                    </a>
                  </>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                    <MessageCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-900">
                        Cliente sin número de WhatsApp válido
                      </p>
                      <p className="text-xs text-amber-800 mt-1">
                        {ultimoCobro.telefono
                          ? `El teléfono registrado (${ultimoCobro.telefono}) no es un celular peruano de 9 dígitos.`
                          : 'Este cliente no tiene número de celular registrado.'}
                        Actualiza el dato en Maestros → Clientes para poder enviar por WhatsApp.
                      </p>
                      <a
                        href={`/boleta/${ultimoCobro.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-xs text-amber-900 underline"
                      >
                        <FileText className="w-3 h-3" /> Ver comprobante interno
                      </a>
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-2 border-t border-gray-100">
                  <Button
                    variant="outline"
                    onClick={() => { setEnviarOpen(false); setUltimoCobro(null); setDetailOpen(false) }}
                  >
                    Cerrar
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
