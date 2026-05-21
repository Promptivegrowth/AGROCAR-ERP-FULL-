'use client'

import { useEffect, useState } from 'react'
import { Search, Plus, Minus, Trash2, AlertCircle, Loader2, Package, User as UserIcon, ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const MINIMO_PEDIDO = 30
const DESCUENTO_MAX_SIN_AUTH = 2.5

interface Cliente {
  id: string
  razon_social: string
  ruc: string | null
  dni: string | null
  direccion: string | null
  telefono: string | null
  lista_precio_id: string | null
  tipo_comprobante_preferido?: string | null
  estado: string
}

interface Producto {
  id: string
  codigo: string | null
  nombre: string
  descripcion: string | null
  tiene_lote: boolean
  tiene_vencimiento: boolean
  precio: number
  stock_cantidad: number
  um: string
}

interface DireccionCliente {
  id: string
  nombre: string
  direccion: string
  es_principal: boolean
}

interface ItemCarrito {
  producto: Producto
  cantidad: number
  subtotal: number
}

interface Vendedor {
  id: string
  full_name: string | null
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}

export default function NuevoPedidoDialog({ open, onOpenChange, onCreated }: Props) {
  const supabase = createClient()

  const [loadingData, setLoadingData] = useState(false)

  // Cliente
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [clienteSearch, setClienteSearch] = useState('')
  const debouncedCliente = useDebounce(clienteSearch, 300)
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)

  // Vendedor (opcional)
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [asignarVendedor, setAsignarVendedor] = useState(false)
  const [vendedorId, setVendedorId] = useState<string>('')

  // Productos
  const [productos, setProductos] = useState<Producto[]>([])
  const [productoSearch, setProductoSearch] = useState('')
  const debouncedProducto = useDebounce(productoSearch, 300)
  const [showProductoDropdown, setShowProductoDropdown] = useState(false)
  const [carrito, setCarrito] = useState<ItemCarrito[]>([])

  // Datos del pedido
  const [fechaDespacho, setFechaDespacho] = useState('')
  const [descuento, setDescuento] = useState('')
  const [incluirIgv, setIncluirIgv] = useState(true)
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Tipo de pago y direcciones
  const [tipoPago, setTipoPago] = useState<'contado' | 'credito'>('contado')
  const [direccionesCliente, setDireccionesCliente] = useState<DireccionCliente[]>([])
  const [direccionEntregaId, setDireccionEntregaId] = useState<string>('')

  // Fecha mínima (mañana)
  const fechaMinima = (() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0]
  })()

  // Resetear todo al abrir
  useEffect(() => {
    if (!open) return
    setClienteSearch('')
    setClienteSeleccionado(null)
    setAsignarVendedor(false)
    setVendedorId('')
    setProductoSearch('')
    setCarrito([])
    setFechaDespacho('')
    setDescuento('')
    setIncluirIgv(true)
    setNotas('')
    setTipoPago('contado')
    setDireccionesCliente([])
    setDireccionEntregaId('')
  }, [open])

  // Cargar datos base al abrir
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      setLoadingData(true)
      const [
        { data: cls },
        { data: vds },
        { data: prods },
      ] = await Promise.all([
        supabase
          .from('clientes')
          .select('id, razon_social, ruc, dni, direccion, telefono, lista_precio_id, tipo_comprobante_preferido, estado')
          .eq('estado', 'activo')
          .order('razon_social'),
        supabase
          .from('profiles')
          .select('id, full_name, role')
          .eq('role', 'vendedor')
          .order('full_name'),
        supabase
          .from('productos')
          .select('id, codigo, nombre, descripcion, tiene_lote, tiene_vencimiento, activo, stock(cantidad), unidades_medida(simbolo)')
          .eq('activo', true)
          .order('nombre'),
      ])
      if (cancelled) return
      setClientes((cls ?? []) as Cliente[])
      setVendedores((vds ?? []).map((v: any) => ({ id: v.id, full_name: v.full_name })))
      setProductos((prods ?? []).map((p: any) => ({
        id: p.id, codigo: p.codigo, nombre: p.nombre, descripcion: p.descripcion,
        tiene_lote: !!p.tiene_lote, tiene_vencimiento: !!p.tiene_vencimiento, precio: 0,
        stock_cantidad: Number(p.stock?.[0]?.cantidad ?? p.stock?.cantidad ?? 0),
        um: p.unidades_medida?.simbolo ?? '',
      })))
      setLoadingData(false)
    }
    load()
    return () => { cancelled = true }
  }, [open, supabase])

  // Filtrar clientes
  const clientesFiltrados = (() => {
    const q = debouncedCliente.toLowerCase().trim()
    if (q.length === 0) return clientes.slice(0, 50)
    return clientes.filter((c) =>
      c.razon_social.toLowerCase().includes(q) ||
      (c.ruc ?? '').toLowerCase().includes(q) ||
      (c.dni ?? '').toLowerCase().includes(q)
    ).slice(0, 50)
  })()

  // Filtrar productos
  const productosFiltrados = (() => {
    const q = debouncedProducto.toLowerCase().trim()
    if (q.length === 0) return productos.slice(0, 50)
    return productos.filter((p) =>
      (p.descripcion ?? '').toLowerCase().includes(q) ||
      p.nombre.toLowerCase().includes(q) ||
      (p.codigo ?? '').toLowerCase().includes(q)
    ).slice(0, 50)
  })()

  // Al seleccionar cliente, cargar precios de su lista + direcciones de entrega
  async function seleccionarCliente(c: Cliente) {
    setClienteSeleccionado(c)
    setClienteSearch(c.razon_social)
    setShowClienteDropdown(false)
    setCarrito([])
    setDireccionesCliente([])
    setDireccionEntregaId('')

    // 1. Precios según lista del cliente
    if (c.lista_precio_id) {
      const { data: items } = await supabase
        .from('lista_precio_items')
        .select('producto_id, precio')
        .eq('lista_precio_id', c.lista_precio_id)
        .eq('activo', true)
      const precioMap = new Map<string, number>()
      ;(items ?? []).forEach((i: any) => precioMap.set(i.producto_id, Number(i.precio ?? 0)))
      setProductos((prev) => prev.map((p) => ({ ...p, precio: precioMap.get(p.id) ?? 0 })))
    } else {
      setProductos((prev) => prev.map((p) => ({ ...p, precio: 0 })))
    }

    // 2. Direcciones adicionales del cliente (solo se muestra el selector si hay > 1)
    const { data: dirs } = await (supabase as any)
      .from('cliente_direcciones')
      .select('id, nombre, direccion, es_principal')
      .eq('cliente_id', c.id)
      .eq('activo', true)
      .order('es_principal', { ascending: false })
    const lista = (dirs ?? []) as DireccionCliente[]
    setDireccionesCliente(lista)
    // Preseleccionar la principal si existe
    const principal = lista.find((d) => d.es_principal) ?? lista[0]
    if (principal) setDireccionEntregaId(principal.id)
  }

  function agregarProducto(p: Producto) {
    setCarrito((prev) => {
      const exist = prev.find((s) => s.producto.id === p.id)
      if (exist) {
        return prev.map((s) => s.producto.id === p.id
          ? { ...s, cantidad: s.cantidad + 1, subtotal: (s.cantidad + 1) * s.producto.precio }
          : s)
      }
      return [...prev, { producto: p, cantidad: 1, subtotal: p.precio }]
    })
    setProductoSearch('')
    setShowProductoDropdown(false)
  }

  function cambiarCantidad(productoId: string, delta: number) {
    setCarrito((prev) =>
      prev.map((s) => {
        if (s.producto.id !== productoId) return s
        const nueva = s.cantidad + delta
        if (nueva <= 0) return null
        return { ...s, cantidad: nueva, subtotal: nueva * s.producto.precio }
      }).filter(Boolean) as ItemCarrito[]
    )
  }

  function setCantidadDirecta(productoId: string, valor: number) {
    if (!Number.isFinite(valor) || valor <= 0) return
    setCarrito((prev) =>
      prev.map((s) => s.producto.id === productoId
        ? { ...s, cantidad: valor, subtotal: valor * s.producto.precio }
        : s),
    )
  }

  function actualizarPrecio(productoId: string, nuevoPrecio: number) {
    setCarrito((prev) =>
      prev.map((s) => s.producto.id === productoId
        ? { ...s, producto: { ...s.producto, precio: nuevoPrecio }, subtotal: s.cantidad * nuevoPrecio }
        : s)
    )
  }

  function quitarProducto(productoId: string) {
    setCarrito((prev) => prev.filter((s) => s.producto.id !== productoId))
  }

  // Totales
  // Los precios de lista YA incluyen IGV. El total final es lo que paga el cliente.
  // baseImponible (subtotal sin IGV) se desglosa hacia atrás.
  const subtotalConIgv = carrito.reduce((acc, s) => acc + s.subtotal, 0)
  const descuentoPct = parseFloat(descuento) || 0
  const descuentoMonto = subtotalConIgv * (descuentoPct / 100)
  const totalFinal = subtotalConIgv - descuentoMonto
  const baseImponible = incluirIgv ? totalFinal / 1.18 : totalFinal
  const igvMonto = incluirIgv ? totalFinal - baseImponible : 0
  // Compat: la UI sigue usando subtotalBruto para mostrar el monto con IGV
  const subtotalBruto = subtotalConIgv
  const requiereAutorizacion = descuentoPct > DESCUENTO_MAX_SIN_AUTH

  const puedeGuardar = !!clienteSeleccionado && carrito.length > 0 && !!fechaDespacho
    && totalFinal >= MINIMO_PEDIDO && (!asignarVendedor || !!vendedorId) && !guardando

  async function guardarPedido() {
    if (!puedeGuardar || !clienteSeleccionado) return
    setGuardando(true)
    try {
      const numero = `P-${Date.now().toString().slice(-8)}`

      // Snapshot textual de la dirección elegida
      const direccionEntrega = direccionesCliente.find((d) => d.id === direccionEntregaId)
      const direccionEntregaTexto = direccionEntrega?.direccion ?? clienteSeleccionado.direccion ?? null

      const { data: pedido, error: pedidoError } = await (supabase.from('pedidos') as any)
        .insert({
          numero,
          cliente_id: clienteSeleccionado.id,
          vendedor_id: asignarVendedor && vendedorId ? vendedorId : null,
          fecha_pedido: new Date().toISOString().split('T')[0],
          fecha_despacho: fechaDespacho,
          estado: 'enviado',
          tipo_pago: tipoPago,
          direccion_entrega_id: direccionEntregaId || null,
          direccion_entrega_texto: direccionEntregaTexto,
          descuento_porcentaje: descuentoPct,
          descuento_monto: descuentoMonto,
          subtotal: baseImponible,
          igv: igvMonto,
          incluir_igv: incluirIgv,
          total: totalFinal,
          requiere_autorizacion: requiereAutorizacion,
          notas: notas.trim() || (requiereAutorizacion ? `Descuento ${descuentoPct}% requiere autorización` : null),
        })
        .select()
        .single()

      if (pedidoError || !pedido) {
        throw new Error(pedidoError?.message ?? 'No se pudo crear el pedido')
      }

      // FEFO: asignar lote por producto con stock disponible
      const conLote = carrito.filter((s) => s.producto.tiene_lote || s.producto.tiene_vencimiento)
      const lotePorProducto: Record<string, string | null> = {}
      if (conLote.length > 0) {
        const ids = conLote.map((s) => s.producto.id)
        const { data: lotes } = await supabase
          .from('lotes')
          .select('id, producto_id, fecha_vencimiento, cantidad_actual')
          .in('producto_id', ids)
          .eq('activo', true)
          .gt('cantidad_actual', 0)
          .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
        for (const s of conLote) {
          const lote = (lotes ?? []).find((l: any) => l.producto_id === s.producto.id)
          lotePorProducto[s.producto.id] = lote ? (lote as any).id : null
        }
      }

      const itemsToInsert = carrito.map((s) => ({
        pedido_id: pedido.id,
        producto_id: s.producto.id,
        lote_id: lotePorProducto[s.producto.id] ?? null,
        cantidad: s.cantidad,
        precio_unitario: s.producto.precio,
        descuento_porcentaje: descuentoPct,
        subtotal: s.subtotal,
      }))

      const { error: itemsError } = await (supabase.from('pedidos_items') as any).insert(itemsToInsert)
      if (itemsError) throw new Error(itemsError.message)

      toast.success('Pedido creado', {
        description: `${numero} · ${clienteSeleccionado.razon_social} · ${formatCurrency(totalFinal)}`,
      })
      onCreated()
      onOpenChange(false)
    } catch (err: any) {
      toast.error('No se pudo crear el pedido', { description: err?.message })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Pedido</DialogTitle>
        </DialogHeader>

        {loadingData ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5 mt-2">
            {/* 1. Cliente */}
            <div>
              <Label className="text-sm font-semibold">1. Cliente *</Label>
              <div className="relative mt-1 flex gap-1">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Buscar por razón social, RUC o DNI..."
                    value={clienteSearch}
                    onChange={(e) => {
                      setClienteSearch(e.target.value)
                      setShowClienteDropdown(true)
                      if (clienteSeleccionado) setClienteSeleccionado(null)
                    }}
                    onFocus={() => setShowClienteDropdown(true)}
                    className="pl-9"
                  />
                </div>
                <button
                  type="button"
                  title="Ver todos los clientes"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    if (showClienteDropdown) {
                      setShowClienteDropdown(false)
                    } else {
                      setClienteSearch('')
                      if (clienteSeleccionado) setClienteSeleccionado(null)
                      setShowClienteDropdown(true)
                    }
                  }}
                  className="h-10 w-10 flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 shrink-0"
                >
                  <ChevronLeft className={`w-4 h-4 text-gray-500 transition-transform ${showClienteDropdown ? 'rotate-90' : '-rotate-90'}`} />
                </button>
                {showClienteDropdown && clientesFiltrados.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-30 mt-1 overflow-hidden max-h-72 overflow-y-auto">
                    {clientesFiltrados.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => seleccionarCliente(c)}
                        className="w-full text-left px-4 py-2.5 hover:bg-green-50 border-b border-gray-100 last:border-0"
                      >
                        <div className="font-medium text-gray-900 text-sm truncate">{c.razon_social}</div>
                        <div className="text-xs text-gray-500">
                          {c.ruc ? `RUC ${c.ruc}` : c.dni ? `DNI ${c.dni}` : 'Sin doc.'}
                          {c.direccion ? ` · ${c.direccion}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {clienteSeleccionado && (
                <div className="mt-2 p-3 bg-green-50 border border-green-100 rounded-lg">
                  <div className="font-medium text-green-900 text-sm">{clienteSeleccionado.razon_social}</div>
                  <div className="text-xs text-green-700 font-mono mt-0.5">
                    {clienteSeleccionado.ruc ? `RUC ${clienteSeleccionado.ruc}` :
                     clienteSeleccionado.dni ? `DNI ${clienteSeleccionado.dni}` : 'Sin documento'}
                  </div>
                  {clienteSeleccionado.tipo_comprobante_preferido && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700 border border-blue-200 mt-1.5">
                      Emite: {clienteSeleccionado.tipo_comprobante_preferido === 'factura' ? 'Factura' : 'Boleta'}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* 2. Vendedor (opcional) */}
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-semibold flex items-center gap-2">
                    <UserIcon className="w-4 h-4 text-gray-500" />
                    2. Vendedor para comisión
                  </Label>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Asigna un vendedor si quieres que este pedido cuente para sus comisiones. Si no, el pedido queda como venta de oficina.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAsignarVendedor(!asignarVendedor)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${asignarVendedor ? 'bg-green-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${asignarVendedor ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              {asignarVendedor && (
                <Select value={vendedorId} onValueChange={setVendedorId}>
                  <SelectTrigger className="mt-2"><SelectValue placeholder="Seleccionar vendedor..." /></SelectTrigger>
                  <SelectContent>
                    {vendedores.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.full_name ?? 'Sin nombre'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* 3. Fecha despacho + Tipo de pago + Dirección */}
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-semibold">3. Fecha de despacho *</Label>
                  <Input
                    type="date"
                    min={fechaMinima}
                    value={fechaDespacho}
                    onChange={(e) => setFechaDespacho(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm font-semibold">4. Tipo de pago *</Label>
                  <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 mt-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setTipoPago('contado')}
                      className={`px-3 py-1.5 rounded ${tipoPago === 'contado' ? 'bg-green-600 text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      💵 Contado
                    </button>
                    <button
                      type="button"
                      onClick={() => setTipoPago('credito')}
                      className={`px-3 py-1.5 rounded ${tipoPago === 'credito' ? 'bg-amber-600 text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      🕒 Crédito {clienteSeleccionado?.['credito_dias' as keyof Cliente] ? `(${(clienteSeleccionado as any).credito_dias} días)` : ''}
                    </button>
                  </div>
                </div>
              </div>

              {/* Dirección de entrega: solo se muestra si el cliente tiene > 1 dirección */}
              {direccionesCliente.length > 1 && (
                <div>
                  <Label className="text-sm font-semibold">5. Dirección de entrega *</Label>
                  <Select value={direccionEntregaId} onValueChange={setDireccionEntregaId}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent>
                      {direccionesCliente.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.es_principal ? '⭐ ' : ''}{d.nombre}: {d.direccion}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {direccionesCliente.length === 1 && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-gray-500">📍 Entrega a:</p>
                  <p className="text-sm font-medium text-gray-900">{direccionesCliente[0].direccion}</p>
                </div>
              )}
              {/* Cliente sin direcciones adicionales: usar la dirección principal del cliente */}
              {direccionesCliente.length === 0 && clienteSeleccionado?.direccion && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-gray-500">📍 Entrega a (dirección del cliente):</p>
                  <p className="text-sm font-medium text-gray-900">{clienteSeleccionado.direccion}</p>
                </div>
              )}
              {direccionesCliente.length === 0 && !clienteSeleccionado?.direccion && clienteSeleccionado && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-800">Este cliente no tiene dirección registrada. Agrega una en Maestros → Clientes.</p>
                </div>
              )}
            </div>

            {/* 4. Productos */}
            <div className="border-t border-gray-100 pt-4">
              <Label className="text-sm font-semibold">4. Productos *</Label>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Buscar producto por nombre o código..."
                  value={productoSearch}
                  onChange={(e) => {
                    setProductoSearch(e.target.value)
                    setShowProductoDropdown(true)
                  }}
                  onFocus={() => setShowProductoDropdown(true)}
                  disabled={!clienteSeleccionado}
                  className="pl-9"
                />
                {showProductoDropdown && productosFiltrados.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-30 mt-1 overflow-hidden max-h-72 overflow-y-auto">
                    {productosFiltrados.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => agregarProducto(p)}
                        className="w-full text-left px-4 py-2.5 hover:bg-green-50 border-b border-gray-100 last:border-0 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-gray-900 text-sm truncate">{p.descripcion?.trim() || p.nombre}</div>
                          <div className="text-[10px] text-gray-400 font-mono">{p.codigo}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                            p.stock_cantidad === 0 ? 'bg-gray-100 text-gray-500' :
                            p.stock_cantidad <= 10 ? 'bg-red-50 text-red-700 border border-red-200' :
                            'bg-green-50 text-green-700 border border-green-200'
                          }`}>
                            Stock: {p.stock_cantidad} {p.um}
                          </div>
                          <div className="text-green-700 font-semibold text-sm">{formatCurrency(p.precio)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {carrito.length === 0 ? (
                <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg mt-2">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Busca y agrega productos al pedido</p>
                  {!clienteSeleccionado && <p className="text-[11px] mt-1">Selecciona un cliente primero</p>}
                </div>
              ) : (
                <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Producto</th>
                        <th className="text-center py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase">Stock</th>
                        <th className="text-center py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase">Cantidad</th>
                        <th className="text-right py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase">P. Unit.</th>
                        <th className="text-right py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Subtotal</th>
                        <th className="py-2 px-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {carrito.map(({ producto, cantidad, subtotal }) => {
                        const stockN = Number(producto.stock_cantidad ?? 0)
                        const um = producto.um ?? ''
                        const supera = cantidad > stockN
                        return (
                        <tr key={producto.id} className={supera ? 'bg-red-50/50' : ''}>
                          <td className="py-2 px-3">
                            <div className="font-medium text-gray-900 text-sm truncate max-w-[260px]">
                              {producto.descripcion?.trim() || producto.nombre}
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono">{producto.codigo}</div>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className={`inline-block text-[10px] font-mono px-1.5 py-0.5 rounded ${
                              stockN === 0 ? 'bg-gray-100 text-gray-500' :
                              stockN <= 10 ? 'bg-red-50 text-red-700 border border-red-200' :
                              'bg-green-50 text-green-700 border border-green-200'
                            }`} title={`Stock actual: ${stockN} ${um}`}>
                              {stockN} {um}
                            </span>
                            {supera && (
                              <div className="text-[9px] text-red-600 font-semibold mt-0.5">⚠️ supera stock</div>
                            )}
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex items-center justify-center gap-1">
                              <button type="button" onClick={() => cambiarCantidad(producto.id, -1)}
                                className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 flex items-center justify-center shrink-0">
                                <Minus className="w-3 h-3" />
                              </button>
                              <Input
                                type="number"
                                min={1}
                                step="1"
                                value={cantidad}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value)
                                  if (Number.isFinite(v) && v > 0) setCantidadDirecta(producto.id, v)
                                }}
                                onFocus={(e) => e.target.select()}
                                inputMode="numeric"
                                className="h-7 w-16 text-center text-xs font-semibold px-1 font-mono"
                              />
                              <button type="button" onClick={() => cambiarCantidad(producto.id, 1)}
                                className="w-6 h-6 rounded bg-[#FBE600] hover:bg-[#E5D100] flex items-center justify-center shrink-0">
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                          <td className="py-2 px-2">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={producto.precio}
                              onChange={(e) => actualizarPrecio(producto.id, parseFloat(e.target.value) || 0)}
                              className="h-7 text-xs text-right font-mono w-24 ml-auto"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-gray-900">{formatCurrency(subtotal)}</td>
                          <td className="py-2 px-2">
                            <button type="button" onClick={() => quitarProducto(producto.id)} className="text-red-400 hover:text-red-600">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 5. Descuento + IGV + Total */}
            {carrito.length > 0 && (
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <Label className="text-sm font-semibold">5. Descuento y Total</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Descuento (%)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      placeholder="0.00"
                      value={descuento}
                      onChange={(e) => setDescuento(e.target.value)}
                      className="mt-1 h-9"
                    />
                    {requiereAutorizacion && (
                      <div className="mt-1.5 flex items-center gap-1 text-amber-700 text-[11px]">
                        <AlertCircle className="w-3 h-3" />
                        Requiere autorización (&gt;{DESCUENTO_MAX_SIN_AUTH}%)
                      </div>
                    )}
                  </div>
                  <div className="flex items-end justify-between bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-xs font-medium text-blue-900">Aplica IGV (18%)</p>
                      <p className="text-[10px] text-blue-700">Desactivar para operaciones sin IGV</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIncluirIgv(!incluirIgv)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${incluirIgv ? 'bg-green-500' : 'bg-gray-300'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${incluirIgv ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Notas (opcional)</Label>
                  <Input
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    placeholder="Observaciones del pedido..."
                    className="mt-1 h-9"
                  />
                </div>

                <div className="bg-gray-50 rounded-lg p-4 space-y-1.5">
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Subtotal (precios c/IGV)</span>
                    <span className="font-mono">{formatCurrency(subtotalBruto)}</span>
                  </div>
                  {descuentoPct > 0 && (
                    <div className="flex justify-between text-sm text-red-600">
                      <span>Descuento ({descuentoPct}%)</span>
                      <span className="font-mono">-{formatCurrency(descuentoMonto)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs text-gray-500 pt-1.5 border-t border-gray-200 mt-1">
                    <span>Base imponible (sin IGV)</span>
                    <span className="font-mono">{formatCurrency(baseImponible)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>IGV (18%){!incluirIgv && <span className="text-amber-600 ml-1">· desactivado</span>}</span>
                    <span className="font-mono">{formatCurrency(igvMonto)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2 mt-1">
                    <span>Total a pagar</span>
                    <span className="text-green-600">{formatCurrency(totalFinal)}</span>
                  </div>
                </div>

                {totalFinal < MINIMO_PEDIDO && totalFinal > 0 && (
                  <div className="flex items-center gap-1.5 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">El pedido mínimo es {formatCurrency(MINIMO_PEDIDO)}</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
              <Button
                onClick={guardarPedido}
                disabled={!puedeGuardar}
                className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
              >
                {guardando && <Loader2 className="w-4 h-4 animate-spin" />}
                Crear Pedido
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
