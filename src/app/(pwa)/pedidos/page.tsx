'use client'

import { useState, useEffect, useCallback } from 'react'
import { ShoppingCart, Search, Plus, Minus, Trash2, AlertCircle, CheckCircle, Loader2, Package } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Cliente, Producto, Pedido } from '@/types'

type Tab = 'nuevo' | 'mis-pedidos'

interface ProductoSeleccionado {
  producto: Producto & { precio: number }
  cantidad: number
  subtotal: number
}

interface PedidoConTotal extends Pedido {
  total: number
}

const MINIMO_PEDIDO = 30
const DESCUENTO_MAX_SIN_AUTH = 2.5

export default function PedidosPage() {
  const [tab, setTab] = useState<Tab>('nuevo')
  const [userId, setUserId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)

  // Nuevo pedido
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [clienteSearch, setClienteSearch] = useState('')
  const [clientesFiltrados, setClientesFiltrados] = useState<Cliente[]>([])
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)
  const [deudaCliente, setDeudaCliente] = useState<number>(0)
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)

  const [fechaDespacho, setFechaDespacho] = useState('')
  const [productosDisponibles, setProductosDisponibles] = useState<(Producto & { precio: number })[]>([])
  const [productoSearch, setProductoSearch] = useState('')
  const [productosFiltrados, setProductosFiltrados] = useState<(Producto & { precio: number })[]>([])
  const [showProductoDropdown, setShowProductoDropdown] = useState(false)
  const [seleccionados, setSeleccionados] = useState<ProductoSeleccionado[]>([])
  const [descuento, setDescuento] = useState('')
  const [loadingEnvio, setLoadingEnvio] = useState(false)
  const [mensajeExito, setMensajeExito] = useState<string | null>(null)
  const [mensajeError, setMensajeError] = useState<string | null>(null)

  // Mis pedidos
  const [misPedidos, setMisPedidos] = useState<PedidoConTotal[]>([])
  const [loadingPedidos, setLoadingPedidos] = useState(false)

  const supabase = createClient()

  // Fecha mínima de despacho (mañana)
  const fechaMinima = (() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0]
  })()

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile) {
        setUserRole(profile.role)
      }

      // Cargar clientes asignados al vendedor
      const { data: clientesData } = await supabase
        .from('clientes')
        .select('*')
        .eq('vendedor_id', user.id)
        .eq('estado', 'activo')
        .order('razon_social')

      if (clientesData) {
        setClientes(clientesData)
      }

      // Cargar productos activos con precio 0 como default (se actualizará al seleccionar cliente)
      const { data: productosData } = await supabase
        .from('productos')
        .select('id, nombre, codigo, activo')
        .eq('activo', true)
        .order('nombre')

      if (productosData) {
        const mapped = productosData.map((p: { id: string; nombre: string; codigo?: string; activo?: boolean }) => ({
          ...p,
          precio: 0,
        }))
        setProductosDisponibles(mapped as (Producto & { precio: number })[])
      }
    }
    init()
  }, [])

  // Filtrar clientes
  useEffect(() => {
    if (clienteSearch.length < 2) {
      setClientesFiltrados([])
      setShowClienteDropdown(false)
      return
    }
    const q = clienteSearch.toLowerCase()
    const filtrados = clientes.filter(
      (c) =>
        c.razon_social.toLowerCase().includes(q) ||
        (c.codigo ?? '').toLowerCase().includes(q)
    )
    setClientesFiltrados(filtrados.slice(0, 8))
    setShowClienteDropdown(true)
  }, [clienteSearch, clientes])

  // Filtrar productos
  useEffect(() => {
    if (productoSearch.length < 2) {
      setProductosFiltrados([])
      setShowProductoDropdown(false)
      return
    }
    const q = productoSearch.toLowerCase()
    const filtrados = productosDisponibles.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) ||
        (p.codigo ?? '').toLowerCase().includes(q)
    )
    setProductosFiltrados(filtrados.slice(0, 8))
    setShowProductoDropdown(true)
  }, [productoSearch, productosDisponibles])

  async function seleccionarCliente(cliente: Cliente) {
    setClienteSeleccionado(cliente)
    setClienteSearch(cliente.razon_social)
    setShowClienteDropdown(false)
    setSeleccionados([])

    // Obtener deuda: sumar total de cobros del cliente
    const { data: cobros } = await supabase
      .from('cobros')
      .select('total')
      .eq('cliente_id', cliente.id)

    const deuda = cobros?.reduce((acc, c) => acc + ((c as any).total ?? 0), 0) ?? 0
    setDeudaCliente(deuda)

    // Cargar productos con precio según lista del cliente
    if (cliente.lista_precio_id) {
      const { data: productosData } = await supabase
        .from('lista_precio_items')
        .select('producto_id, precio, productos!inner(id, nombre, codigo, activo)')
        .eq('lista_precio_id', cliente.lista_precio_id)
        .eq('activo', true)

      if (productosData) {
        const mapped = productosData
          .filter((item: { productos?: { activo?: boolean } }) => item.productos?.activo)
          .map((item: { producto_id: string; precio: number; productos?: { id?: string; nombre?: string; codigo?: string; activo?: boolean } }) => ({
            id: item.producto_id,
            nombre: item.productos?.nombre ?? '',
            codigo: item.productos?.codigo ?? null,
            activo: item.productos?.activo ?? true,
            precio: item.precio,
          }))
        setProductosDisponibles(mapped as (Producto & { precio: number })[])
        return
      }
    }
    // Fallback: cargar todos sin precio específico
    const { data: productosData } = await supabase
      .from('productos')
      .select('id, nombre, codigo, activo')
      .eq('activo', true)
      .order('nombre')

    if (productosData) {
      const mapped = productosData.map((p: { id: string; nombre: string; codigo?: string; activo?: boolean }) => ({
        ...p,
        precio: 0,
      }))
      setProductosDisponibles(mapped as (Producto & { precio: number })[])
    }

  }

  function agregarProducto(producto: Producto & { precio: number }) {
    setSeleccionados((prev) => {
      const existe = prev.find((s) => s.producto.id === producto.id)
      if (existe) {
        return prev.map((s) =>
          s.producto.id === producto.id
            ? { ...s, cantidad: s.cantidad + 1, subtotal: (s.cantidad + 1) * s.producto.precio }
            : s
        )
      }
      return [...prev, { producto, cantidad: 1, subtotal: producto.precio }]
    })
    setProductoSearch('')
    setShowProductoDropdown(false)
  }

  function cambiarCantidad(productoId: string, delta: number) {
    setSeleccionados((prev) =>
      prev
        .map((s) => {
          if (s.producto.id !== productoId) return s
          const nuevaCantidad = s.cantidad + delta
          if (nuevaCantidad <= 0) return null
          return { ...s, cantidad: nuevaCantidad, subtotal: nuevaCantidad * s.producto.precio }
        })
        .filter(Boolean) as ProductoSeleccionado[]
    )
  }

  function quitarProducto(productoId: string) {
    setSeleccionados((prev) => prev.filter((s) => s.producto.id !== productoId))
  }

  const subtotalBruto = seleccionados.reduce((acc, s) => acc + s.subtotal, 0)
  const descuentoPct = parseFloat(descuento) || 0
  const descuentoMonto = subtotalBruto * (descuentoPct / 100)
  const totalFinal = subtotalBruto - descuentoMonto
  const requiereAutorizacion = descuentoPct > DESCUENTO_MAX_SIN_AUTH
  const pedidoMinimo = totalFinal >= MINIMO_PEDIDO || seleccionados.length === 0

  async function enviarPedido() {
    if (!clienteSeleccionado || seleccionados.length === 0 || !fechaDespacho || !userId) return
    setLoadingEnvio(true)
    setMensajeError(null)
    setMensajeExito(null)

    try {
      // Generar número de pedido único
      const numero = `P-${Date.now().toString().slice(-8)}`

      const { data: pedido, error: pedidoError } = await supabase
        .from('pedidos')
        .insert({
          numero,
          cliente_id: clienteSeleccionado.id,
          vendedor_id: userId,
          fecha_pedido: new Date().toISOString().split('T')[0],
          fecha_despacho: fechaDespacho,
          estado: 'enviado',
          descuento_porcentaje: descuentoPct,
          descuento_monto: descuentoMonto,
          subtotal: subtotalBruto,
          total: totalFinal,
          requiere_autorizacion: requiereAutorizacion,
          notas: requiereAutorizacion ? `Descuento ${descuentoPct}% requiere autorización` : null,
        })
        .select()
        .single()

      if (pedidoError || !pedido) {
        setMensajeError('Error al crear el pedido: ' + (pedidoError?.message ?? 'Desconocido'))
        return
      }

      const items = seleccionados.map((s) => ({
        pedido_id: pedido.id,
        producto_id: s.producto.id,
        cantidad: s.cantidad,
        precio_unitario: s.producto.precio,
        descuento_porcentaje: descuentoPct,
        subtotal: s.subtotal,
      }))

      const { error: itemsError } = await supabase.from('pedidos_items').insert(items)

      if (itemsError) {
        setMensajeError('Error al guardar los items: ' + itemsError.message)
        return
      }

      setMensajeExito('Pedido enviado correctamente')
      setClienteSeleccionado(null)
      setClienteSearch('')
      setSeleccionados([])
      setFechaDespacho('')
      setDescuento('')
      setDeudaCliente(0)
      setTab('mis-pedidos')
      cargarMisPedidos()
    } catch {
      setMensajeError('Error inesperado al enviar el pedido')
    } finally {
      setLoadingEnvio(false)
    }
  }

  const cargarMisPedidos = useCallback(async () => {
    if (!userId) return
    setLoadingPedidos(true)
    const hoy = new Date().toISOString().split('T')[0]

    const { data } = await supabase
      .from('pedidos')
      .select('*')
      .eq('vendedor_id', userId)
      .gte('created_at', hoy)
      .order('created_at', { ascending: false })

    setMisPedidos((data ?? []) as PedidoConTotal[])
    setLoadingPedidos(false)
  }, [userId])

  useEffect(() => {
    if (tab === 'mis-pedidos' && userId) {
      cargarMisPedidos()
    }
  }, [tab, userId, cargarMisPedidos])

  const estadoBadgeColor: Record<string, string> = {
    borrador: 'bg-gray-100 text-gray-700',
    enviado: 'bg-blue-100 text-blue-700',
    validado: 'bg-indigo-100 text-indigo-700',
    facturado: 'bg-purple-100 text-purple-700',
    despachado: 'bg-orange-100 text-orange-700',
    entregado: 'bg-green-100 text-green-700',
    cancelado: 'bg-red-100 text-red-700',
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="bg-green-600 text-white px-4 pt-6 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <ShoppingCart className="w-6 h-6" />
          <h1 className="text-xl font-bold">Pedidos</h1>
        </div>
        {/* Tabs */}
        <div className="flex bg-green-700/50 rounded-xl p-1 gap-1">
          {(['nuevo', 'mis-pedidos'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === t ? 'bg-white text-green-700' : 'text-green-100 hover:text-white'
              }`}
            >
              {t === 'nuevo' ? 'Nuevo Pedido' : 'Mis Pedidos'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {tab === 'nuevo' && (
          <>
            {mensajeExito && (
              <div className="bg-green-50 border border-green-200 text-green-700 flex items-center gap-2 px-4 py-3 rounded-xl">
                <CheckCircle className="w-4 h-4 shrink-0" />
                {mensajeExito}
              </div>
            )}
            {mensajeError && (
              <div className="bg-red-50 border border-red-200 text-red-700 flex items-center gap-2 px-4 py-3 rounded-xl">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {mensajeError}
              </div>
            )}

            {/* Selector de cliente */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-800 mb-3">1. Cliente</h3>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Buscar cliente por nombre o código..."
                    value={clienteSearch}
                    onChange={(e) => {
                      setClienteSearch(e.target.value)
                      if (clienteSeleccionado) {
                        setClienteSeleccionado(null)
                        setDeudaCliente(0)
                      }
                    }}
                    className="pl-9 h-12 text-base"
                  />
                  {showClienteDropdown && clientesFiltrados.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 mt-1 overflow-hidden">
                      {clientesFiltrados.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => seleccionarCliente(c)}
                          className="w-full text-left px-4 py-3 hover:bg-green-50 border-b border-gray-100 last:border-0"
                        >
                          <div className="font-medium text-gray-900 text-sm">{c.razon_social}</div>
                          <div className="text-xs text-gray-500">{c.codigo} · {c.direccion}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {clienteSeleccionado && (
                  <div className="mt-3 p-3 bg-green-50 rounded-lg">
                    <div className="font-medium text-green-800">{clienteSeleccionado.razon_social}</div>
                    <div className="text-xs text-green-700 mt-0.5">{clienteSeleccionado.direccion}</div>
                    {deudaCliente > 0 && (
                      <div className="mt-2 flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">
                          Deuda pendiente: {formatCurrency(deudaCliente)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Fecha de despacho */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-800 mb-3">2. Fecha de Despacho</h3>
                <Input
                  type="date"
                  min={fechaMinima}
                  value={fechaDespacho}
                  onChange={(e) => setFechaDespacho(e.target.value)}
                  className="h-12 text-base"
                />
              </CardContent>
            </Card>

            {/* Productos */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-800 mb-3">3. Productos</h3>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Agregar producto..."
                    value={productoSearch}
                    onChange={(e) => setProductoSearch(e.target.value)}
                    disabled={!clienteSeleccionado}
                    className="pl-9 h-12 text-base"
                  />
                  {showProductoDropdown && productosFiltrados.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 mt-1 overflow-hidden">
                      {productosFiltrados.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => agregarProducto(p)}
                          className="w-full text-left px-4 py-3 hover:bg-green-50 border-b border-gray-100 last:border-0"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium text-gray-900 text-sm">{p.nombre}</div>
                              <div className="text-xs text-gray-500">{p.codigo}</div>
                            </div>
                            <div className="text-green-700 font-semibold text-sm">
                              {formatCurrency(p.precio)}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Lista de productos seleccionados */}
                {seleccionados.length === 0 ? (
                  <div className="text-center py-6 text-gray-400">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Busca y agrega productos al pedido</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {seleccionados.map(({ producto, cantidad, subtotal }) => (
                      <div key={producto.id} className="bg-gray-50 rounded-xl p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 text-sm truncate">{producto.nombre}</div>
                            <div className="text-xs text-gray-500">{formatCurrency(producto.precio)} c/u</div>
                          </div>
                          <button
                            onClick={() => quitarProducto(producto.id)}
                            className="text-red-400 hover:text-red-600 ml-2 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => cambiarCantidad(producto.id, -1)}
                              className="w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="font-bold text-gray-900 w-8 text-center">{cantidad}</span>
                            <button
                              onClick={() => cambiarCantidad(producto.id, 1)}
                              className="w-8 h-8 rounded-full bg-green-600 hover:bg-green-700 flex items-center justify-center text-white transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="font-bold text-green-700">{formatCurrency(subtotal)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Descuento y total */}
            {seleccionados.length > 0 && (
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <h3 className="font-semibold text-gray-800">4. Descuento y Total</h3>

                  <div>
                    <label className="text-sm text-gray-600 mb-1 block">Descuento (%)</label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      placeholder="0.00"
                      value={descuento}
                      onChange={(e) => setDescuento(e.target.value)}
                      className="h-12 text-base"
                    />
                    {requiereAutorizacion && (
                      <div className="mt-2 flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">
                          Descuento mayor a {DESCUENTO_MAX_SIN_AUTH}% requiere autorización del gerente
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Subtotal</span>
                      <span>{formatCurrency(subtotalBruto)}</span>
                    </div>
                    {descuentoPct > 0 && (
                      <div className="flex justify-between text-sm text-red-600">
                        <span>Descuento ({descuentoPct}%)</span>
                        <span>-{formatCurrency(descuentoMonto)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-gray-900 text-lg border-t border-gray-200 pt-1.5 mt-1.5">
                      <span>Total</span>
                      <span className="text-green-700">{formatCurrency(totalFinal)}</span>
                    </div>
                  </div>

                  {totalFinal < MINIMO_PEDIDO && totalFinal > 0 && (
                    <div className="flex items-center gap-1.5 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium">
                        El pedido mínimo es {formatCurrency(MINIMO_PEDIDO)}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Botón enviar */}
            <Button
              onClick={enviarPedido}
              disabled={
                !clienteSeleccionado ||
                seleccionados.length === 0 ||
                !fechaDespacho ||
                totalFinal < MINIMO_PEDIDO ||
                loadingEnvio
              }
              className="w-full h-14 bg-green-600 hover:bg-green-700 text-white font-bold text-base rounded-xl shadow-md"
            >
              {loadingEnvio ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Enviando pedido...
                </>
              ) : (
                <>
                  <ShoppingCart className="w-5 h-5" />
                  Enviar Pedido
                </>
              )}
            </Button>
          </>
        )}

        {tab === 'mis-pedidos' && (
          <div className="space-y-3">
            {loadingPedidos ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-green-600" />
              </div>
            ) : misPedidos.length === 0 ? (
              <div className="text-center py-12">
                <ShoppingCart className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500 font-medium">Sin pedidos hoy</p>
                <p className="text-gray-400 text-sm">Los pedidos enviados hoy aparecerán aquí</p>
              </div>
            ) : (
              misPedidos.map((pedido) => (
                <Card key={pedido.id} className="border-0 shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold text-gray-900 text-sm">
                          Pedido #{pedido.id.slice(-8).toUpperCase()}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          Despacho: {formatDate(pedido.fecha_despacho ?? '')}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span
                          className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                            estadoBadgeColor[pedido.estado] ?? 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {pedido.estado.charAt(0).toUpperCase() + pedido.estado.slice(1)}
                        </span>
                        <span className="font-bold text-green-700">{formatCurrency(pedido.total ?? 0)}</span>
                      </div>
                    </div>
                    {(pedido as Pedido & { requiere_autorizacion?: boolean }).requiere_autorizacion && (
                      <div className="mt-2 flex items-center gap-1.5 text-amber-700 text-xs">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Requiere autorización de descuento
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
