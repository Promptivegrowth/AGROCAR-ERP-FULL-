'use client'

import { useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShoppingCart, Search, Eye, Loader2, ChevronLeft, ChevronRight, MapPin,
  Package, AlertTriangle, User, Calendar, FileText, Truck, CheckCircle,
  XCircle, Clock, Plus,
} from 'lucide-react'
import NuevoPedidoDialog from './nuevo-pedido-dialog'
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
  const [nuevoOpen, setNuevoOpen] = useState(false)

  // Edición del pedido (solo si estado='enviado')
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editItems, setEditItems] = useState<Record<string, { cantidad: string; precio: string }>>({})
  // Form para agregar producto
  const [productoSearch, setProductoSearch] = useState('')
  const debouncedProductoSearch = useDebounce(productoSearch, 250)
  const [productosOpciones, setProductosOpciones] = useState<any[]>([])
  const [nuevoProd, setNuevoProd] = useState<{ id: string; nombre: string; codigo: string; precio: number } | null>(null)
  const [nuevaCantidad, setNuevaCantidad] = useState('')
  const [nuevoPrecio, setNuevoPrecio] = useState('')

  const filtrados = useMemo(() => {
    return pedidos.filter((p) => {
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase()
        const matchCliente = (p.clientes?.razon_social ?? '').toLowerCase().includes(q)
        const matchRuc = (p.clientes?.ruc ?? '').toLowerCase().includes(q)
        const matchDni = (p.clientes?.dni ?? '').toLowerCase().includes(q)
        const matchNumero = (p.numero ?? '').toLowerCase().includes(q)
        if (!matchCliente && !matchRuc && !matchDni && !matchNumero) return false
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
    setEditMode(false)
    setEditItems({})
    setNuevoProd(null)
    setNuevaCantidad('')
    setProductoSearch('')
    const [{ data }, { data: comp }] = await Promise.all([
      supabase
        .from('pedidos_items')
        .select('id, cantidad, precio_unitario, descuento_porcentaje, subtotal, productos(codigo, nombre, descripcion, unidades_medida(simbolo))')
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

  // Recarga los items del pedido actual y refresca la lista de pedidos
  const recargarPedidoActual = async () => {
    if (!selected) return
    const { data } = await supabase
      .from('pedidos_items')
      .select('id, cantidad, precio_unitario, descuento_porcentaje, subtotal, productos(codigo, nombre, descripcion, unidades_medida(simbolo))')
      .eq('pedido_id', selected.id)
    setItems(data ?? [])
    // Releer cabecera (totales pueden haber cambiado)
    const { data: ped } = await (supabase as any)
      .from('pedidos')
      .select('id, subtotal, igv, descuento_monto, descuento_porcentaje, total, incluir_igv, estado, requiere_reposicion')
      .eq('id', selected.id)
      .maybeSingle()
    if (ped) {
      const p: any = ped
      setSelected({ ...selected, ...p })
      setPedidos((prev) => prev.map((x) => x.id === p.id ? { ...x, ...p } : x))
    }
    setEditItems({})
  }

  // ─── Eliminar pedido ─────────────────────────────────────
  const eliminarPedido = async () => {
    if (!selected) return
    if (!confirm(`¿Eliminar definitivamente el pedido ${selected.numero}? Esta acción borra el pedido y libera la reserva de stock.`)) return
    setSaving(true)
    const { error } = await (supabase.rpc as any)('eliminar_pedido', { p_pedido_id: selected.id })
    setSaving(false)
    if (error) {
      toast.error('No se pudo eliminar', { description: error.message })
      return
    }
    toast.success('Pedido eliminado', { description: `${selected.numero} fue eliminado.` })
    setPedidos((prev) => prev.filter((x) => x.id !== selected.id))
    setDetailOpen(false)
  }

  // ─── Agregar producto ─────────────────────────────────────
  // Buscar productos cuando el usuario tipea (incluye precio de lista A si existe)
  useMemo(() => {
    if (!editMode || !debouncedProductoSearch.trim()) {
      setProductosOpciones([])
      return
    }
    ;(async () => {
      const q = debouncedProductoSearch.trim()
      const { data } = await (supabase as any)
        .from('productos')
        .select(`
          id, codigo, nombre, descripcion,
          lista_precio_items(precio, listas_precio(nombre))
        `)
        .eq('activo', true)
        .or(`codigo.ilike.%${q}%,nombre.ilike.%${q}%,descripcion.ilike.%${q}%`)
        .limit(8)
      // Extraer precio de la lista A si está disponible
      const items = (data ?? []).map((p: any) => {
        const precioA = (p.lista_precio_items ?? []).find((it: any) => it.listas_precio?.nombre === 'A')
        return {
          ...p,
          precio_sugerido: Number(precioA?.precio ?? 0),
        }
      })
      setProductosOpciones(items)
    })()
  }, [debouncedProductoSearch, editMode, supabase])

  const agregarProducto = async () => {
    if (!selected || !nuevoProd) return
    const cant = parseFloat(nuevaCantidad)
    const precio = parseFloat(nuevoPrecio)
    if (!cant || cant <= 0) {
      toast.error('Cantidad inválida')
      return
    }
    if (isNaN(precio) || precio < 0) {
      toast.error('Precio inválido')
      return
    }
    setSaving(true)
    const { error } = await (supabase.rpc as any)('agregar_item_pedido', {
      p_pedido_id: selected.id,
      p_producto_id: nuevoProd.id,
      p_cantidad: cant,
      p_precio_unitario: precio,
      p_descuento_porcentaje: selected.descuento_porcentaje ?? 0,
      p_force_reserva: false,
    })
    setSaving(false)
    if (error) {
      toast.error('No se pudo agregar', { description: error.message })
      return
    }
    toast.success('Producto agregado')
    setNuevoProd(null)
    setNuevaCantidad('')
    setNuevoPrecio('')
    setProductoSearch('')
    setProductosOpciones([])
    await recargarPedidoActual()
  }

  // ─── Editar / Eliminar item ──────────────────────────────
  const guardarEdicionItem = async (itemId: string) => {
    const draft = editItems[itemId]
    if (!draft) return
    const cant = parseFloat(draft.cantidad)
    const precio = parseFloat(draft.precio)
    if (!cant || cant <= 0 || isNaN(precio) || precio < 0) {
      toast.error('Cantidad o precio inválidos')
      return
    }
    setSaving(true)
    const { error } = await (supabase.rpc as any)('editar_item_pedido', {
      p_item_id: itemId,
      p_cantidad: cant,
      p_precio_unitario: precio,
    })
    setSaving(false)
    if (error) {
      toast.error('No se pudo editar', { description: error.message })
      return
    }
    toast.success('Item actualizado')
    await recargarPedidoActual()
  }

  // Detecta items con cambios sin guardar (drafts cuya cantidad o precio difieren del item original)
  const draftsPendientes = useMemo(() => {
    return Object.entries(editItems).filter(([itemId, draft]) => {
      const it = items.find((i: any) => i.id === itemId)
      if (!it) return false
      return parseFloat(draft.cantidad) !== Number(it.cantidad)
          || parseFloat(draft.precio) !== Number(it.precio_unitario)
    })
  }, [editItems, items])

  // Guarda TODOS los cambios pendientes de una sola vez
  const guardarTodosLosCambios = async () => {
    if (draftsPendientes.length === 0) return
    setSaving(true)
    let exitos = 0
    let fallos = 0
    let primerError = ''
    for (const [itemId, draft] of draftsPendientes) {
      const cant = parseFloat(draft.cantidad)
      const precio = parseFloat(draft.precio)
      if (!cant || cant <= 0 || isNaN(precio) || precio < 0) {
        fallos++
        if (!primerError) primerError = 'Cantidad o precio inválidos en una línea'
        continue
      }
      const { error } = await (supabase.rpc as any)('editar_item_pedido', {
        p_item_id: itemId,
        p_cantidad: cant,
        p_precio_unitario: precio,
      })
      if (error) {
        fallos++
        if (!primerError) primerError = error.message
      } else {
        exitos++
      }
    }
    setSaving(false)
    if (fallos === 0) {
      toast.success(`${exitos} línea${exitos === 1 ? '' : 's'} actualizada${exitos === 1 ? '' : 's'}`)
    } else {
      toast.warning(`${exitos} guardadas, ${fallos} con error`, { description: primerError })
    }
    await recargarPedidoActual()
  }

  const descartarCambios = () => {
    if (draftsPendientes.length === 0) {
      setEditMode(false)
      return
    }
    if (confirm(`Descartar ${draftsPendientes.length} cambio${draftsPendientes.length === 1 ? '' : 's'} sin guardar?`)) {
      setEditItems({})
      setEditMode(false)
    }
  }

  // Salir de edición: si hay cambios, pedir confirmación; si no, salir limpio
  const salirEdicion = () => {
    if (draftsPendientes.length === 0) {
      setEditMode(false)
      return
    }
    const accion = confirm(
      `Tienes ${draftsPendientes.length} cambio${draftsPendientes.length === 1 ? '' : 's'} sin guardar.\n\n` +
      'Aceptar = Guardar y salir\n' +
      'Cancelar = Continuar editando'
    )
    if (accion) {
      guardarTodosLosCambios().then(() => setEditMode(false))
    }
  }

  const eliminarItem = async (itemId: string, nombre: string) => {
    if (!confirm(`¿Quitar "${nombre}" del pedido?`)) return
    setSaving(true)
    const { data, error } = await (supabase.rpc as any)('eliminar_item_pedido', { p_item_id: itemId })
    setSaving(false)
    if (error) {
      toast.error('No se pudo quitar', { description: error.message })
      return
    }
    if ((data as any)?.pedido_eliminado) {
      toast.success('Último item: el pedido fue eliminado.')
      setPedidos((prev) => prev.filter((x) => x.id !== selected.id))
      setDetailOpen(false)
      return
    }
    toast.success('Producto quitado del pedido')
    await recargarPedidoActual()
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Estado y trazabilidad de todos los pedidos del sistema
          </p>
        </div>
        <Button
          onClick={() => setNuevoOpen(true)}
          className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2 w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" /> Nuevo Pedido
        </Button>
      </div>

      <NuevoPedidoDialog
        open={nuevoOpen}
        onOpenChange={setNuevoOpen}
        onCreated={() => router.refresh()}
      />

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
                placeholder="Buscar por cliente, RUC, DNI o N° pedido..."
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
                      {(p as any).solicitud_mayorista && (
                        <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-orange-100 text-orange-800 border border-orange-300">
                          🏭 Solicitud precio mayorista
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
                          <td className="py-3 px-4 font-medium text-gray-900 max-w-[260px]">
                            <div className="truncate">{p.clientes?.razon_social ?? '—'}</div>
                            <div className="flex items-center gap-1 flex-wrap mt-0.5">
                              {p.requiere_autorizacion && (
                                <AlertTriangle className="inline w-3 h-3 text-amber-500" />
                              )}
                              {(p as any).solicitud_mayorista && (
                                <span
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[9px] font-bold bg-orange-100 text-orange-800 border border-orange-300"
                                  title="Solicitud de precio MAYORISTA por el vendedor"
                                >
                                  🏭 MAYORISTA
                                </span>
                              )}
                            </div>
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

                {(selected as any).solicitud_mayorista && (
                  <div className="bg-orange-50 border-2 border-orange-300 rounded-lg p-3 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-lg shrink-0">🏭</span>
                      <div>
                        <p className="font-bold text-orange-900">Solicitud de precio MAYORISTA</p>
                        <p className="text-xs text-orange-800 mt-1 leading-snug">
                          El vendedor activó el botón <strong>&ldquo;Solicitar precio mayorista&rdquo;</strong> al armar este pedido.
                          Los precios fueron tomados de la lista <strong>MAYORISTA</strong> aunque el cliente esté registrado en otra lista.
                          Verifica antes de facturar.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Items */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Productos
                    </p>
                    {editMode && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                        Modo edición
                      </span>
                    )}
                  </div>
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
                            {editMode && <th className="px-3 py-2 w-20"></th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {items.map((it: any) => {
                            const nombreProd = it.productos?.descripcion?.trim() || it.productos?.nombre || '—'
                            const draft = editItems[it.id]
                            const cantInput = draft?.cantidad ?? String(it.cantidad)
                            const precioInput = draft?.precio ?? String(it.precio_unitario)
                            const dirty = draft && (parseFloat(cantInput) !== Number(it.cantidad) || parseFloat(precioInput) !== Number(it.precio_unitario))
                            return (
                              <tr key={it.id}>
                                <td className="px-3 py-2">
                                  <div className="font-medium text-gray-900 text-sm">{nombreProd}</div>
                                  <div className="text-xs text-gray-400 font-mono">{it.productos?.codigo}</div>
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-sm">
                                  {editMode ? (
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={cantInput}
                                      onChange={(e) => setEditItems((prev) => ({ ...prev, [it.id]: { cantidad: e.target.value, precio: precioInput } }))}
                                      className="w-20 text-right border border-gray-200 rounded px-1.5 py-1 text-sm font-mono"
                                      disabled={saving}
                                    />
                                  ) : (
                                    <>{Number(it.cantidad ?? 0)} {it.productos?.unidades_medida?.simbolo ?? ''}</>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-sm">
                                  {editMode ? (
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={precioInput}
                                      onChange={(e) => setEditItems((prev) => ({ ...prev, [it.id]: { cantidad: cantInput, precio: e.target.value } }))}
                                      className="w-24 text-right border border-gray-200 rounded px-1.5 py-1 text-sm font-mono"
                                      disabled={saving}
                                    />
                                  ) : (
                                    formatCurrency(Number(it.precio_unitario ?? 0))
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-sm font-semibold">
                                  {formatCurrency(editMode ? (parseFloat(cantInput) || 0) * (parseFloat(precioInput) || 0) : Number(it.subtotal ?? 0))}
                                </td>
                                {editMode && (
                                  <td className="px-2 py-2 text-right whitespace-nowrap">
                                    {dirty && (
                                      <span
                                        className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-2"
                                        title="Modificado — pulsa Guardar cambios para confirmar"
                                      />
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => eliminarItem(it.id, nombreProd)}
                                      disabled={saving}
                                      className="text-xs text-red-600 hover:bg-red-50 w-6 h-6 rounded font-bold"
                                      title="Quitar item"
                                    >
                                      ×
                                    </button>
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Form para agregar producto (solo en edit mode) */}
                  {editMode && (
                    <div className="mt-3 border border-dashed border-gray-300 rounded-lg p-3 bg-gray-50/40">
                      <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Agregar producto</p>
                      {!nuevoProd ? (
                        <div className="relative">
                          <Input
                            placeholder="Buscar por código o nombre..."
                            value={productoSearch}
                            onChange={(e) => setProductoSearch(e.target.value)}
                            disabled={saving}
                            className="h-9 text-sm"
                          />
                          {productosOpciones.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-md max-h-48 overflow-y-auto z-10">
                              {productosOpciones.map((p: any) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => {
                                    const precioSug = Number(p.precio_sugerido ?? 0)
                                    setNuevoProd({
                                      id: p.id, codigo: p.codigo,
                                      nombre: p.descripcion?.trim() || p.nombre,
                                      precio: precioSug,
                                    })
                                    setNuevoPrecio(precioSug > 0 ? String(precioSug) : '')
                                    setProductoSearch('')
                                    setProductosOpciones([])
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0"
                                >
                                  <div className="font-medium">{p.descripcion?.trim() || p.nombre}</div>
                                  <div className="text-xs text-gray-400 font-mono">
                                    {p.codigo}{p.precio_sugerido > 0 && ` · Lista A: S/ ${Number(p.precio_sugerido).toFixed(2)}`}
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between bg-white border border-gray-200 rounded-md px-3 py-2">
                            <div className="text-sm">
                              <div className="font-medium">{nuevoProd.nombre}</div>
                              <div className="text-xs text-gray-400 font-mono">{nuevoProd.codigo}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => { setNuevoProd(null); setNuevaCantidad(''); setNuevoPrecio('') }}
                              className="text-xs text-gray-500 hover:text-gray-700"
                            >
                              Cambiar
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="Cantidad"
                              value={nuevaCantidad}
                              onChange={(e) => setNuevaCantidad(e.target.value)}
                              disabled={saving}
                              className="h-9 text-sm"
                            />
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="Precio S/"
                              value={nuevoPrecio}
                              onChange={(e) => setNuevoPrecio(e.target.value)}
                              disabled={saving}
                              className="h-9 text-sm"
                            />
                            <Button
                              size="sm"
                              onClick={agregarProducto}
                              disabled={saving || !nuevaCantidad || !nuevoPrecio}
                              className="h-9 bg-green-600 hover:bg-green-700 text-white"
                            >
                              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                              Agregar
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
                  {(() => {
                    const incluirIgv = selected.incluir_igv !== false
                    const descuentoPct = Number(selected.descuento_porcentaje ?? 0)
                    let sumaItems = 0
                    let hayCambios = false

                    if (editMode) {
                      // Suma EN VIVO usando los inputs editados (drafts)
                      // Si el item tiene draft, usar cantidad×precio del draft
                      // Si no, usar el subtotal actual del item
                      for (const it of items) {
                        const draft = editItems[it.id]
                        if (draft) {
                          const c = parseFloat(draft.cantidad) || 0
                          const p = parseFloat(draft.precio) || 0
                          const sub = c * p
                          sumaItems += sub
                          if (sub !== Number(it.subtotal ?? 0)) hayCambios = true
                        } else {
                          sumaItems += Number(it.subtotal ?? 0)
                        }
                      }
                    } else {
                      // Modo normal: usar lo persistido en el pedido
                      sumaItems = items.reduce((acc, it) => acc + Number(it.subtotal ?? 0), 0)
                      if (sumaItems === 0) sumaItems = Number(selected.subtotal ?? 0) + Number(selected.igv ?? 0)
                    }

                    // sumaItems está CON IGV (es lo que guarda el modelo). Desagregar:
                    const descuentoMonto = sumaItems * descuentoPct / 100
                    const baseConIgv = sumaItems - descuentoMonto
                    const igv = incluirIgv ? baseConIgv - (baseConIgv / 1.18) : 0
                    const subtotalSinIgv = baseConIgv - igv
                    const total = baseConIgv

                    return (
                      <>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Subtotal</span>
                          <span className="font-mono">{formatCurrency(subtotalSinIgv)}</span>
                        </div>
                        {descuentoMonto > 0 && (
                          <div className="flex justify-between text-red-600">
                            <span>Descuento ({descuentoPct}%)</span>
                            <span className="font-mono">-{formatCurrency(descuentoMonto)}</span>
                          </div>
                        )}
                        {incluirIgv ? (
                          <div className="flex justify-between text-gray-600">
                            <span>IGV (18%)</span>
                            <span className="font-mono">{formatCurrency(igv)}</span>
                          </div>
                        ) : (
                          <div className="flex justify-between text-xs text-amber-700">
                            <span>Operación sin IGV</span>
                            <span>—</span>
                          </div>
                        )}
                        <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
                          <span className="font-semibold text-gray-900">Total</span>
                          <span className="font-mono font-bold text-lg text-black">
                            {formatCurrency(total)}
                          </span>
                        </div>
                        {editMode && hayCambios && (
                          <p className="text-[10px] text-amber-700 italic mt-1 text-right">
                            Vista previa de cambios. Pulsa <strong>Guardar cambios</strong> para confirmar.
                          </p>
                        )}
                      </>
                    )
                  })()}
                </div>

                {selected.notas && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-900">
                    <strong>Nota:</strong> {selected.notas}
                  </div>
                )}

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-gray-100 flex-wrap">
                  <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>

                  {/* MODO EDICIÓN: botones específicos */}
                  {selected.estado === 'enviado' && editMode && (
                    <>
                      {draftsPendientes.length > 0 ? (
                        <>
                          <Button
                            variant="outline"
                            onClick={descartarCambios}
                            disabled={saving}
                            className="border-gray-300 text-gray-600 hover:bg-gray-50 gap-2"
                            title="Descartar todos los cambios sin guardar"
                          >
                            Descartar
                          </Button>
                          <Button
                            onClick={guardarTodosLosCambios}
                            disabled={saving}
                            className="bg-green-600 hover:bg-green-700 text-white font-semibold gap-2"
                            title={`Guardar ${draftsPendientes.length} cambio${draftsPendientes.length === 1 ? '' : 's'}`}
                          >
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                            💾 Guardar cambios ({draftsPendientes.length})
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => setEditMode(false)}
                          disabled={saving}
                          className="border-gray-300 text-gray-700 hover:bg-gray-50 gap-2"
                          title="Salir del modo edición"
                        >
                          Salir de edición
                        </Button>
                      )}
                    </>
                  )}

                  {/* MODO NORMAL: botones de acción */}
                  {selected.estado === 'enviado' && !editMode && (
                    <>
                      <Button
                        variant="outline"
                        onClick={eliminarPedido}
                        disabled={saving}
                        className="border-red-400 text-red-700 hover:bg-red-50 gap-2"
                        title="Borra el pedido completo y libera la reserva de stock"
                      >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                        🗑️ Eliminar
                      </Button>
                      <Button
                        variant="outline"
                        onClick={cancelarPedido}
                        disabled={cancelando}
                        className="border-gray-300 text-gray-700 hover:bg-gray-50 gap-2"
                        title="Cambia estado a cancelado (no borra del historial)"
                      >
                        {cancelando && <Loader2 className="w-4 h-4 animate-spin" />}
                        <XCircle className="w-4 h-4" /> Cancelar
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setEditMode(true)}
                        disabled={saving}
                        className="border-amber-400 text-amber-800 hover:bg-amber-50 gap-2"
                      >
                        ✏️ Editar
                      </Button>
                    </>
                  )}

                  {(selected.estado === 'enviado' || selected.estado === 'validado') && !editMode && (
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
