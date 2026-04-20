'use client'

import { useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShoppingCart, Search, Eye, Loader2, ChevronLeft, ChevronRight, MapPin,
  Package, AlertTriangle, User, Calendar, FileText, Truck, CheckCircle,
  XCircle, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type EstadoPedido =
  | 'borrador' | 'enviado' | 'validado' | 'facturado' | 'despachado' | 'entregado' | 'cancelado'

const ESTADO_CFG: Record<EstadoPedido, { label: string; className: string; icon: any }> = {
  borrador:   { label: 'Borrador',   className: 'bg-gray-100 text-gray-700 border-gray-200',       icon: FileText },
  enviado:    { label: 'Enviado',    className: 'bg-blue-100 text-blue-700 border-blue-200',       icon: ShoppingCart },
  validado:   { label: 'Validado',   className: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: CheckCircle },
  facturado:  { label: 'Facturado',  className: 'bg-purple-100 text-purple-700 border-purple-200', icon: FileText },
  despachado: { label: 'Despachado', className: 'bg-amber-100 text-amber-700 border-amber-200',    icon: Truck },
  entregado:  { label: 'Entregado',  className: 'bg-green-100 text-green-700 border-green-200',    icon: CheckCircle },
  cancelado:  { label: 'Cancelado',  className: 'bg-red-100 text-red-700 border-red-200',          icon: XCircle },
}

const PAGE_SIZE = 20

export default function PedidosClient({ pedidosIniciales }: { pedidosIniciales: any[] }) {
  const router = useRouter()
  const supabase = createClient()

  const [pedidos, setPedidos] = useState(pedidosIniciales)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [filterEstado, setFilterEstado] = useState<EstadoPedido | 'todos' | 'pendientes'>('todos')
  const [page, setPage] = useState(0)

  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [comprobanteId, setComprobanteId] = useState<string | null>(null)

  const filtrados = useMemo(() => {
    return pedidos.filter((p) => {
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase()
        const matchCliente = (p.clientes?.razon_social ?? '').toLowerCase().includes(q)
        const matchNumero = (p.numero ?? '').toLowerCase().includes(q)
        if (!matchCliente && !matchNumero) return false
      }
      if (filterEstado === 'pendientes') {
        return ['enviado', 'validado'].includes(p.estado)
      }
      if (filterEstado !== 'todos' && p.estado !== filterEstado) return false
      return true
    })
  }, [pedidos, debouncedSearch, filterEstado])

  const totalPages = Math.ceil(filtrados.length / PAGE_SIZE)
  const pageItems = filtrados.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: pedidos.length, pendientes: 0 }
    for (const p of pedidos) {
      c[p.estado] = (c[p.estado] ?? 0) + 1
      if (p.estado === 'enviado' || p.estado === 'validado') c.pendientes += 1
    }
    return c
  }, [pedidos])

  const openDetail = async (p: any) => {
    setSelected(p)
    setDetailOpen(true)
    setLoadingItems(true)
    setComprobanteId(null)
    const [{ data }, { data: comp }] = await Promise.all([
      supabase
        .from('pedidos_items')
        .select('id, cantidad, precio_unitario, descuento_porcentaje, subtotal, productos(codigo, nombre, unidades_medida(simbolo))')
        .eq('pedido_id', p.id),
      supabase
        .from('comprobantes')
        .select('id')
        .eq('pedido_id', p.id)
        .maybeSingle(),
    ])
    setItems(data ?? [])
    setComprobanteId((comp as any)?.id ?? null)
    setLoadingItems(false)
  }

  const cancelarPedido = async () => {
    if (!selected) return
    if (!confirm(`¿Cancelar el pedido ${selected.numero}? Esta acción no se puede revertir.`)) return
    setCancelando(true)
    const { error } = await supabase
      .from('pedidos')
      .update({ estado: 'cancelado', updated_at: new Date().toISOString() })
      .eq('id', selected.id)
    setCancelando(false)
    if (error) {
      toast.error('No se pudo cancelar', { description: error.message })
      return
    }
    toast.success('Pedido cancelado')
    setPedidos((prev) => prev.map((x) => (x.id === selected.id ? { ...x, estado: 'cancelado' } : x)))
    setDetailOpen(false)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Estado y trazabilidad de todos los pedidos del sistema
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total" value={counts.total ?? 0} color="gray" />
        <KpiCard label="Enviados" value={counts.enviado ?? 0} color="blue" />
        <KpiCard label="Facturados" value={counts.facturado ?? 0} color="purple" />
        <KpiCard label="Entregados" value={counts.entregado ?? 0} color="green" />
      </div>

      {/* Filtros */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <Tabs value={filterEstado} onValueChange={(v) => { setFilterEstado(v as any); setPage(0) }}>
            <TabsList className="grid grid-cols-4 sm:inline-flex h-auto flex-wrap">
              <TabsTrigger value="todos">Todos</TabsTrigger>
              <TabsTrigger value="pendientes">
                Pendientes
                {counts.pendientes > 0 && (
                  <span className="ml-1.5 bg-[#FBE600] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {counts.pendientes}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="enviado">Enviados</TabsTrigger>
              <TabsTrigger value="facturado">Facturados</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Buscar por cliente o número..."
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              />
            </div>
            <Select value={filterEstado} onValueChange={(v) => { setFilterEstado(v as any); setPage(0) }}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Estado detallado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los estados</SelectItem>
                {(Object.keys(ESTADO_CFG) as EstadoPedido[]).map((e) => (
                  <SelectItem key={e} value={e}>{ESTADO_CFG[e].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {pageItems.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-gray-400">
              <ShoppingCart className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No hay pedidos con estos filtros</p>
            </div>
          ) : (
            <>
              {/* Móvil */}
              <div className="md:hidden divide-y divide-gray-50">
                {pageItems.map((p) => {
                  const cfg = ESTADO_CFG[p.estado as EstadoPedido] ?? ESTADO_CFG.borrador
                  return (
                    <button
                      key={p.id}
                      onClick={() => openDetail(p)}
                      className="w-full text-left p-4 hover:bg-gray-50/60"
                    >
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs text-gray-500">{p.numero}</p>
                          <p className="font-semibold text-gray-900 truncate">{p.clientes?.razon_social ?? '—'}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {p.profiles?.full_name ?? 'sin vendedor'} · {formatDate(p.fecha_pedido)}
                          </p>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <Badge className={`text-xs border ${cfg.className}`}>{cfg.label}</Badge>
                          <p className="font-mono font-semibold text-sm mt-1">{formatCurrency(p.total ?? 0)}</p>
                        </div>
                      </div>
                      {p.requiere_autorizacion && (
                        <div className="mt-2 flex items-center gap-1 text-amber-700 text-xs">
                          <AlertTriangle className="w-3 h-3" /> Requiere autorización
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Desktop */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {['Número', 'Fecha', 'Cliente', 'Vendedor', 'Despacho', 'Total', 'Estado', ''].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {pageItems.map((p) => {
                      const cfg = ESTADO_CFG[p.estado as EstadoPedido] ?? ESTADO_CFG.borrador
                      return (
                        <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-3 px-4 font-mono text-xs text-gray-600">{p.numero}</td>
                          <td className="py-3 px-4 text-gray-500 text-xs">{formatDate(p.fecha_pedido)}</td>
                          <td className="py-3 px-4 font-medium text-gray-900 max-w-[220px] truncate">
                            {p.clientes?.razon_social ?? '—'}
                            {p.requiere_autorizacion && (
                              <AlertTriangle className="inline w-3 h-3 ml-1 text-amber-500" />
                            )}
                          </td>
                          <td className="py-3 px-4 text-gray-600 text-xs">{p.profiles?.full_name ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs">
                            {p.fecha_despacho ? formatDate(p.fecha_despacho) : '—'}
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold text-gray-800">
                            {formatCurrency(p.total ?? 0)}
                          </td>
                          <td className="py-3 px-4">
                            <Badge className={`text-xs border ${cfg.className}`}>{cfg.label}</Badge>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button variant="ghost" size="sm" onClick={() => openDetail(p)} className="h-7 w-7 p-0">
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                {filtrados.length} pedidos · página {page + 1} / {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="h-7 w-7 p-0">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1} className="h-7 w-7 p-0">
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal detalle */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Pedido {selected?.numero}
            </DialogTitle>
          </DialogHeader>
          {selected && (() => {
            const cfg = ESTADO_CFG[selected.estado as EstadoPedido] ?? ESTADO_CFG.borrador
            const Icon = cfg.icon
            return (
              <div className="space-y-4 mt-2">
                <div className="flex items-start gap-3 pb-4 border-b border-gray-100">
                  <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-gray-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-lg font-semibold text-gray-900">{selected.clientes?.razon_social ?? '—'}</p>
                    <p className="text-xs text-gray-500 font-mono">
                      {selected.clientes?.ruc ?? selected.clientes?.dni ?? 'Sin documento'}
                    </p>
                  </div>
                  <Badge className={`text-xs border ${cfg.className}`}>{cfg.label}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <InfoRow icon={User} label="Vendedor" value={selected.profiles?.full_name ?? '—'} />
                  <InfoRow icon={Calendar} label="Fecha pedido" value={formatDate(selected.fecha_pedido)} />
                  <InfoRow icon={Truck} label="Fecha despacho" value={selected.fecha_despacho ? formatDate(selected.fecha_despacho) : '—'} />
                  <InfoRow icon={MapPin} label="Zona" value={selected.clientes?.zonas?.nombre ?? '—'} />
                </div>

                {selected.requiere_autorizacion && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      Este pedido <strong>requiere autorización</strong> (descuento {selected.descuento_porcentaje}%).
                    </span>
                  </div>
                )}

                {/* Items */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Productos
                  </p>
                  {loadingItems ? (
                    <div className="py-8 flex justify-center">
                      <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                    </div>
                  ) : items.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Sin items</p>
                  ) : (
                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50/50">
                          <tr>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Producto</th>
                            <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Cant.</th>
                            <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Precio</th>
                            <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {items.map((it: any) => (
                            <tr key={it.id}>
                              <td className="px-3 py-2">
                                <div className="font-medium text-gray-900 text-sm">{it.productos?.nombre ?? '—'}</div>
                                <div className="text-xs text-gray-400 font-mono">{it.productos?.codigo}</div>
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-sm">
                                {Number(it.cantidad ?? 0)} {it.productos?.unidades_medida?.simbolo ?? ''}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-sm">
                                {formatCurrency(Number(it.precio_unitario ?? 0))}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-sm font-semibold">
                                {formatCurrency(Number(it.subtotal ?? 0))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Subtotal</span>
                    <span className="font-mono">{formatCurrency(Number(selected.subtotal ?? 0))}</span>
                  </div>
                  {Number(selected.descuento_monto ?? 0) > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>Descuento ({selected.descuento_porcentaje}%)</span>
                      <span className="font-mono">-{formatCurrency(Number(selected.descuento_monto ?? 0))}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
                    <span className="font-semibold text-gray-900">Total</span>
                    <span className="font-mono font-bold text-lg text-black">
                      {formatCurrency(Number(selected.total ?? 0))}
                    </span>
                  </div>
                </div>

                {selected.notas && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-900">
                    <strong>Nota:</strong> {selected.notas}
                  </div>
                )}

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-gray-100">
                  <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>
                  {selected.estado === 'enviado' && (
                    <Button
                      variant="outline"
                      onClick={cancelarPedido}
                      disabled={cancelando}
                      className="border-red-300 text-red-700 hover:bg-red-50 gap-2"
                    >
                      {cancelando && <Loader2 className="w-4 h-4 animate-spin" />}
                      <XCircle className="w-4 h-4" /> Cancelar pedido
                    </Button>
                  )}
                  {(selected.estado === 'enviado' || selected.estado === 'validado') && (
                    <Button
                      onClick={() => router.push('/facturacion')}
                      className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
                    >
                      <FileText className="w-4 h-4" /> Ir a Facturación
                    </Button>
                  )}
                  {comprobanteId && (
                    <Button
                      variant="outline"
                      onClick={() => window.open(`/comprobante/${comprobanteId}`, '_blank')}
                      className="gap-2 border-gray-300"
                    >
                      <FileText className="w-4 h-4" /> Ver Comprobante
                    </Button>
                  )}
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function KpiCard({ label, value, color }: { label: string; value: number; color: 'gray' | 'blue' | 'purple' | 'green' }) {
  const bg = {
    gray: 'bg-gray-50 text-gray-800',
    blue: 'bg-blue-50 text-blue-700',
    purple: 'bg-purple-50 text-purple-700',
    green: 'bg-green-50 text-green-700',
  }[color]
  return (
    <Card className="border-gray-200 shadow-sm">
      <CardContent className="p-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${bg.split(' ')[1]}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-gray-800 text-sm">{value}</p>
      </div>
    </div>
  )
}
