'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { ShoppingCart, Search, Plus, Minus, Trash2, AlertCircle, CheckCircle, Loader2, Package } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { hoyLima } from '@/lib/fechas-pe'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Cliente, Producto, Pedido } from '@/types'
import { clienteVisitaHoy } from '@/lib/dias-visita'

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
  const debouncedClienteSearch = useDebounce(clienteSearch, 300)
  const [clientesFiltrados, setClientesFiltrados] = useState<Cliente[]>([])
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)
  const [deudaCliente, setDeudaCliente] = useState<number>(0)
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)

  const [fechaDespacho, setFechaDespacho] = useState('')
  const [productosDisponibles, setProductosDisponibles] = useState<(Producto & { precio: number })[]>([])
  const [productoSearch, setProductoSearch] = useState('')
  const debouncedProductoSearch = useDebounce(productoSearch, 300)
  const [productosFiltrados, setProductosFiltrados] = useState<(Producto & { precio: number })[]>([])
  const [showProductoDropdown, setShowProductoDropdown] = useState(false)
  const [seleccionados, setSeleccionados] = useState<ProductoSeleccionado[]>([])
  const [descuento, setDescuento] = useState('')
  const [incluirIgv, setIncluirIgv] = useState(true)
  const [loadingEnvio, setLoadingEnvio] = useState(false)
  const [tipoPago, setTipoPago] = useState<'contado' | 'credito'>('contado')
  const [direccionesCliente, setDireccionesCliente] = useState<Array<{ id: string; nombre: string; direccion: string; es_principal: boolean }>>([])
  const [direccionEntregaId, setDireccionEntregaId] = useState<string>('')
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

      // Ejecutar en paralelo: perfil, clientes asignados y productos activos
      const [
        { data: profile },
        { data: clientesData },
        { data: productosData },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single(),
        // Cargar TODOS los clientes activos. Si es vendedor (no repartidor),
        // se filtra en JS después según su rol.
        supabase
          .from('clientes')
          .select('*')
          .eq('estado', 'activo')
          .order('razon_social'),
        supabase
          .from('productos')
          .select('id, nombre, descripcion, codigo, activo, tiene_lote, tiene_vencimiento, stock(cantidad), unidades_medida(simbolo)')
          .eq('activo', true)
          .order('nombre'),
      ])

      const role = (profile as any)?.role ?? null
      if (profile) setUserRole(role)

      if (clientesData) {
        // Mostrar TODOS los clientes activos al vendedor. Los de SUS zonas
        // van primero (default visible); los demás aparecen al buscar.
        // Esto permite tomar pedidos de cualquier cliente si pasa por ahí.
        let lista: any[] = clientesData
        if (role === 'vendedor') {
          const { getClientesIdsVisiblesParaPwa } = await import('@/lib/zonas-vendedor')
          const vis = await getClientesIdsVisiblesParaPwa(supabase, user.id, role)
          let propiosSet: Set<string> | null = null
          if (vis.filtrar) {
            if (vis.zonasAsignadas.length > 0) {
              const zSet = new Set(vis.zonasAsignadas)
              propiosSet = new Set(clientesData.filter((c: any) => c.zona_id && zSet.has(c.zona_id)).map((c: any) => c.id))
            } else if (vis.usarFallbackVendedor) {
              propiosSet = new Set(clientesData.filter((c: any) => c.vendedor_id === user.id).map((c: any) => c.id))
            }
          }
          if (propiosSet) {
            const propiosArr = clientesData.filter((c: any) => propiosSet!.has(c.id))
            const restoArr = clientesData
              .filter((c: any) => !propiosSet!.has(c.id))
              .map((c: any) => ({ ...c, _fuera_de_zona: true }))
            lista = [...propiosArr, ...restoArr]
          }
        }
        setClientes(lista)
      }

      if (productosData) {
        const mapped = productosData.map((p: any) => ({
          ...p,
          precio: 0,
          stock_cantidad: Number(p.stock?.[0]?.cantidad ?? p.stock?.cantidad ?? 0),
          um: p.unidades_medida?.simbolo ?? '',
        }))
        setProductosDisponibles(mapped as any[])
      }
    }
    init()
  }, [])

  // Filtrar clientes
  useEffect(() => {
    if (debouncedClienteSearch.length < 2) {
      setClientesFiltrados([])
      setShowClienteDropdown(false)
      return
    }
    const q = debouncedClienteSearch.toLowerCase()
    const filtrados = clientes.filter(
      (c) =>
        c.razon_social.toLowerCase().includes(q) ||
        (c.ruc ?? '').toLowerCase().includes(q) ||
        (c.dni ?? '').toLowerCase().includes(q)
    )
    setClientesFiltrados(filtrados.slice(0, 8))
    setShowClienteDropdown(true)
  }, [debouncedClienteSearch, clientes])

  // Filtrar productos. Si no hay búsqueda, muestra los primeros 50 al abrir el dropdown.
  useEffect(() => {
    const q = debouncedProductoSearch.toLowerCase().trim()
    if (q.length === 0) {
      setProductosFiltrados(productosDisponibles.slice(0, 50))
      return
    }
    const filtrados = productosDisponibles.filter(
      (p) =>
        ((p as any).descripcion ?? '').toLowerCase().includes(q) ||
        p.nombre.toLowerCase().includes(q) ||
        (p.codigo ?? '').toLowerCase().includes(q)
    )
    setProductosFiltrados(filtrados.slice(0, 50))
    setShowProductoDropdown(true)
  }, [debouncedProductoSearch, productosDisponibles])

  async function seleccionarCliente(cliente: Cliente) {
    setClienteSeleccionado(cliente)
    setClienteSearch(cliente.razon_social)
    setShowClienteDropdown(false)
    setSeleccionados([])

    // Ejecutar en paralelo: comprobantes (facturado), cobros (cobrado), productos, items lista
    const [
      { data: comprobantes },
      { data: cobros },
      { data: allProductos },
      itemsResult,
    ] = await Promise.all([
      supabase
        .from('comprobantes')
        .select('total')
        .eq('cliente_id', cliente.id)
        .neq('estado', 'anulado'),
      supabase
        .from('cobros')
        .select('total')
        .eq('cliente_id', cliente.id),
      supabase
        .from('productos')
        .select('id, nombre, descripcion, codigo, activo, tiene_lote, tiene_vencimiento, stock(cantidad), unidades_medida(simbolo)')
        .eq('activo', true)
        .order('nombre'),
      cliente.lista_precio_id
        ? supabase
            .from('lista_precio_items')
            .select('producto_id, precio')
            .eq('lista_precio_id', cliente.lista_precio_id)
            .eq('activo', true)
        : Promise.resolve({ data: null as any }),
    ])

    const facturado = comprobantes?.reduce((acc, c) => acc + Number((c as any).total ?? 0), 0) ?? 0
    const cobrado = cobros?.reduce((acc, c) => acc + Number((c as any).total ?? 0), 0) ?? 0
    const deuda = Math.max(0, facturado - cobrado)
    setDeudaCliente(deuda)

    // Si el cliente tiene lista de precios asignada, mapear precios específicos
    const precioMap = new Map<string, number>()
    if (cliente.lista_precio_id && itemsResult?.data) {
      ;(itemsResult.data as any[]).forEach((item: any) => {
        precioMap.set(item.producto_id, Number(item.precio ?? 0))
      })
    }

    const mapped = (allProductos ?? []).map((p: any) => ({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion ?? null,
      codigo: p.codigo ?? null,
      activo: p.activo ?? true,
      tiene_lote: !!p.tiene_lote,
      tiene_vencimiento: !!p.tiene_vencimiento,
      stock_cantidad: Number(p.stock?.[0]?.cantidad ?? p.stock?.cantidad ?? 0),
      um: p.unidades_medida?.simbolo ?? '',
      precio: precioMap.get(p.id) ?? 0,
    }))
    setProductosDisponibles(mapped as any[])

    // Cargar direcciones del cliente
    const { data: dirs } = await (supabase as any)
      .from('cliente_direcciones')
      .select('id, nombre, direccion, es_principal')
      .eq('cliente_id', cliente.id)
      .eq('activo', true)
      .order('es_principal', { ascending: false })
    const lista = (dirs ?? []) as Array<{ id: string; nombre: string; direccion: string; es_principal: boolean }>
    setDireccionesCliente(lista)
    const principal = lista.find((d) => d.es_principal) ?? lista[0]
    setDireccionEntregaId(principal?.id ?? '')
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

  function setCantidadDirecta(productoId: string, valor: number) {
    if (!Number.isFinite(valor) || valor <= 0) return
    setSeleccionados((prev) =>
      prev.map((s) =>
        s.producto.id === productoId
          ? { ...s, cantidad: valor, subtotal: valor * s.producto.precio }
          : s,
      ),
    )
  }

  function quitarProducto(productoId: string) {
    setSeleccionados((prev) => prev.filter((s) => s.producto.id !== productoId))
  }

  // Precios de lista incluyen IGV. El total es el monto a pagar; la base
  // imponible (subtotal sin IGV) se desglosa hacia atrás.
  const subtotalConIgv = seleccionados.reduce((acc, s) => acc + s.subtotal, 0)
  const descuentoPct = parseFloat(descuento) || 0
  const descuentoMonto = subtotalConIgv * (descuentoPct / 100)
  const totalFinal = subtotalConIgv - descuentoMonto
  const baseImponible = incluirIgv ? totalFinal / 1.18 : totalFinal
  const igvMonto = incluirIgv ? totalFinal - baseImponible : 0
  const subtotalBruto = subtotalConIgv
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

      // Snapshot textual de dirección elegida
      const dirEnt = direccionesCliente.find((d) => d.id === direccionEntregaId)
      const dirEntTexto = dirEnt?.direccion ?? clienteSeleccionado.direccion ?? null

      const { data: pedido, error: pedidoError } = await (supabase.from('pedidos') as any)
        .insert({
          numero,
          cliente_id: clienteSeleccionado.id,
          vendedor_id: userId,
          fecha_pedido: hoyLima(),
          fecha_despacho: fechaDespacho,
          estado: 'enviado',
          tipo_pago: tipoPago,
          direccion_entrega_id: direccionEntregaId || null,
          direccion_entrega_texto: dirEntTexto,
          descuento_porcentaje: descuentoPct,
          descuento_monto: descuentoMonto,
          subtotal: baseImponible,
          igv: igvMonto,
          incluir_igv: incluirIgv,
          total: totalFinal,
          requiere_autorizacion: requiereAutorizacion,
          notas: requiereAutorizacion ? `Descuento ${descuentoPct}% requiere autorización` : null,
        })
        .select()
        .single()

      if (pedidoError || !pedido) {
        const msg = 'Error al crear el pedido: ' + (pedidoError?.message ?? 'Desconocido')
        setMensajeError(msg)
        toast.error('No se pudo enviar el pedido', {
          description: pedidoError?.message ?? 'Error desconocido',
        })
        return
      }

      // Para productos con lote, intentar asignar el lote más próximo a vencer (FEFO)
      const productosConLote = seleccionados.filter(
        (s) => (s.producto as any).tiene_lote === true || (s.producto as any).tiene_vencimiento === true
      )
      let lotePorProducto: Record<string, string | null> = {}
      let productosSinLote: string[] = []

      if (productosConLote.length > 0) {
        const ids = productosConLote.map((s) => s.producto.id)
        const { data: lotesDisp } = await supabase
          .from('lotes')
          .select('id, producto_id, fecha_vencimiento, cantidad_actual')
          .in('producto_id', ids)
          .eq('activo', true)
          .gt('cantidad_actual', 0)
          .order('fecha_vencimiento', { ascending: true, nullsFirst: false })

        // Tomamos el primer lote disponible por producto (menor fecha_vencimiento)
        for (const s of productosConLote) {
          const lote = (lotesDisp ?? []).find((l: any) => l.producto_id === s.producto.id)
          if (lote) {
            lotePorProducto[s.producto.id] = (lote as any).id
          } else {
            productosSinLote.push((s.producto as any).descripcion?.trim() || s.producto.nombre)
          }
        }

        if (productosSinLote.length > 0) {
          toast.warning('Productos sin lote disponible', {
            description: `No se encontró lote con stock para: ${productosSinLote.join(', ')}`,
          })
        }
      }

      const items = seleccionados.map((s) => ({
        pedido_id: pedido.id,
        producto_id: s.producto.id,
        lote_id: lotePorProducto[s.producto.id] ?? null,
        cantidad: s.cantidad,
        precio_unitario: s.producto.precio,
        descuento_porcentaje: descuentoPct,
        subtotal: s.subtotal,
      }))

      const { error: itemsError } = await supabase.from('pedidos_items').insert(items)

      if (itemsError) {
        setMensajeError('Error al guardar los items: ' + itemsError.message)
        toast.error('Error al guardar los items', { description: itemsError.message })
        return
      }

      // Auto check-in si no hay uno HOY de este vendedor en este cliente
      try {
        const hoy = hoyLima()
        const { data: existing } = await (supabase as any)
          .from('gps_checkins')
          .select('id')
          .eq('usuario_id', userId)
          .eq('cliente_id', clienteSeleccionado.id)
          .eq('tipo', 'entrada')
          .gte('created_at', `${hoy}T00:00:00`)
          .limit(1)
          .maybeSingle()

        if (!existing) {
          // Intentar capturar GPS del vendedor; si falla, usar coords del cliente
          const obtenerCoords = (): Promise<[number | null, number | null]> =>
            new Promise((resolve) => {
              if (!navigator.geolocation) return resolve([null, null])
              navigator.geolocation.getCurrentPosition(
                (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
                () => resolve([null, null]),
                { enableHighAccuracy: false, timeout: 4000 },
              )
            })
          const [lat, lng] = await obtenerCoords()
          await (supabase as any).from('gps_checkins').insert({
            usuario_id: userId,
            cliente_id: clienteSeleccionado.id,
            tipo: 'entrada',
            latitud: lat ?? clienteSeleccionado.latitud ?? null,
            longitud: lng ?? clienteSeleccionado.longitud ?? null,
            notas: 'Check-in auto al tomar pedido',
          })
        }
      } catch {
        /* check-in es best-effort, no rompe el flujo del pedido */
      }

      setMensajeExito('Pedido enviado correctamente')
      toast.success('Pedido enviado', {
        description: `${numero} · ${clienteSeleccionado.razon_social}`,
      })
      setClienteSeleccionado(null)
      setClienteSearch('')
      setSeleccionados([])
      setFechaDespacho('')
      setDescuento('')
      setDeudaCliente(0)
      setTipoPago('contado')
      setDireccionesCliente([])
      setDireccionEntregaId('')
      setTab('mis-pedidos')
      cargarMisPedidos()
    } catch {
      setMensajeError('Error inesperado al enviar el pedido')
      toast.error('Error inesperado', { description: 'No se pudo enviar el pedido.' })
    } finally {
      setLoadingEnvio(false)
    }
  }

  const cargarMisPedidos = useCallback(async () => {
    if (!userId) return
    setLoadingPedidos(true)
    const hoy = hoyLima()

    // Vendedor: solo los pedidos que él creó.
    // Repartidor: todos los pedidos del día (para ver qué despachar).
    let q = supabase
      .from('pedidos')
      .select('*')
      .gte('created_at', hoy)
      .order('created_at', { ascending: false })
    if (userRole === 'vendedor') q = q.eq('vendedor_id', userId)

    const { data } = await q

    setMisPedidos((data ?? []) as PedidoConTotal[])
    setLoadingPedidos(false)
  }, [userId, userRole])

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
      <div className="bg-black text-white px-4 pt-6 pb-4 border-b-4 border-[#FBE600]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <ShoppingCart className="w-6 h-6" />
            <h1 className="text-xl font-bold">Pedidos</h1>
          </div>
          <Image src="/logo-agrocar.png" alt="AGROCAR" width={120} height={32} className="object-contain" />
        </div>
        {/* Tabs */}
        <div className="flex bg-white/10 rounded-xl p-1 gap-1">
          {(['nuevo', 'mis-pedidos'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === t ? 'bg-[#FBE600] text-black' : 'text-gray-300 hover:text-white'
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
                    placeholder="Buscar por nombre, RUC o DNI..."
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
                      {clientesFiltrados.map((c) => {
                        const fueraZona = (c as any)._fuera_de_zona === true
                        return (
                          <button
                            key={c.id}
                            onClick={() => seleccionarCliente(c)}
                            className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 ${
                              fueraZona ? 'hover:bg-amber-50 bg-amber-50/30' : 'hover:bg-green-50'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className="font-medium text-gray-900 text-sm flex-1 min-w-0 truncate">{c.razon_social}</div>
                              {clienteVisitaHoy((c as any).dias_visita) && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-200 text-yellow-900">
                                  📅 HOY
                                </span>
                              )}
                              {fueraZona && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-200">
                                  Fuera de zona
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">
                              {c.ruc ? `RUC ${c.ruc}` : c.dni ? `DNI ${c.dni}` : 'Sin doc.'}
                              {c.direccion ? ` · ${c.direccion}` : ''}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {clienteSeleccionado && (
                  <div className="mt-3 p-3 bg-green-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-green-800 flex-1 min-w-0">{clienteSeleccionado.razon_social}</div>
                      {clienteVisitaHoy((clienteSeleccionado as any).dias_visita) && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-200 text-yellow-900 border border-yellow-300">
                          📅 HOY TE TOCA
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-green-700 mt-0.5 font-mono">
                      {clienteSeleccionado.ruc
                        ? `RUC ${clienteSeleccionado.ruc}`
                        : clienteSeleccionado.dni
                          ? `DNI ${clienteSeleccionado.dni}`
                          : 'Sin documento'}
                    </div>
                    {clienteSeleccionado.direccion && (
                      <div className="text-xs text-green-700 mt-0.5">{clienteSeleccionado.direccion}</div>
                    )}
                    <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200">
                      Emite: {(clienteSeleccionado as any).tipo_comprobante_preferido === 'factura' ? 'Factura' : 'Boleta'}
                    </div>
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

            {/* Dirección de entrega (solo si > 1) */}
            {clienteSeleccionado && direccionesCliente.length > 1 && (
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <h3 className="font-semibold text-gray-800 mb-3">📍 Dirección de entrega</h3>
                  <div className="space-y-2">
                    {direccionesCliente.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setDireccionEntregaId(d.id)}
                        className={`w-full text-left p-3 rounded-xl border-2 transition-colors ${
                          direccionEntregaId === d.id
                            ? 'border-green-500 bg-green-50'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-sm text-gray-900">
                            {d.es_principal && <span className="text-amber-500">⭐ </span>}
                            {d.nombre}
                          </div>
                          {direccionEntregaId === d.id && <span className="text-green-600 text-xs">✓ Elegida</span>}
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">{d.direccion}</div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

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

            {/* Tipo de pago */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-800 mb-3">💳 Tipo de Pago</h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTipoPago('contado')}
                    className={`p-3 rounded-xl border-2 transition-colors ${
                      tipoPago === 'contado'
                        ? 'border-green-500 bg-green-50 text-green-800 font-semibold'
                        : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    💵 Contado
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoPago('credito')}
                    className={`p-3 rounded-xl border-2 transition-colors ${
                      tipoPago === 'credito'
                        ? 'border-amber-500 bg-amber-50 text-amber-800 font-semibold'
                        : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    🕒 Crédito
                    {(clienteSeleccionado as any)?.credito_dias > 0 && (
                      <div className="text-[10px] font-normal mt-0.5">({(clienteSeleccionado as any).credito_dias} días)</div>
                    )}
                  </button>
                </div>
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
                      {productosFiltrados.map((p) => {
                        const stockN = Number((p as any).stock_cantidad ?? 0)
                        const um = (p as any).um ?? ''
                        return (
                          <button
                            key={p.id}
                            onClick={() => agregarProducto(p)}
                            className="w-full text-left px-4 py-3 hover:bg-green-50 border-b border-gray-100 last:border-0"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-gray-900 text-sm truncate">{(p as any).descripcion?.trim() || p.nombre}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[10px] text-gray-400 font-mono">{p.codigo}</span>
                                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                    stockN === 0 ? 'bg-gray-100 text-gray-500' :
                                    stockN <= 10 ? 'bg-red-50 text-red-700' :
                                    'bg-green-50 text-green-700'
                                  }`}>
                                    Stock: {stockN} {um}
                                  </span>
                                </div>
                              </div>
                              <div className="text-green-700 font-semibold text-sm shrink-0">
                                {formatCurrency(p.precio)}
                              </div>
                            </div>
                          </button>
                        )
                      })}
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
                    {seleccionados.map(({ producto, cantidad, subtotal }) => {
                      const stockN = Number((producto as any).stock_cantidad ?? 0)
                      const umP = (producto as any).um ?? ''
                      const supera = cantidad > stockN
                      return (
                      <div key={producto.id} className={`rounded-xl p-3 ${supera ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 text-sm truncate">{(producto as any).descripcion?.trim() || producto.nombre}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-gray-500">{formatCurrency(producto.precio)} c/u</span>
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                stockN === 0 ? 'bg-gray-200 text-gray-500' :
                                stockN <= 10 ? 'bg-red-100 text-red-700' :
                                'bg-green-100 text-green-700'
                              }`}>
                                Stock: {stockN} {umP}
                              </span>
                            </div>
                            {supera && (
                              <div className="text-[10px] text-red-700 font-semibold mt-1">⚠️ La cantidad supera el stock disponible</div>
                            )}
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
                              className="w-9 h-9 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors shrink-0"
                            >
                              <Minus className="w-4 h-4" />
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
                              className="h-9 w-16 text-center font-bold text-base px-1"
                            />
                            <button
                              onClick={() => cambiarCantidad(producto.id, 1)}
                              className="w-9 h-9 rounded-full bg-[#FBE600] hover:bg-[#E5D100] flex items-center justify-center text-black transition-colors shrink-0"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="font-bold text-green-700">{formatCurrency(subtotal)}</div>
                        </div>
                      </div>
                      )
                    })}
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

                  <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-blue-900">Aplica IGV (18%)</p>
                      <p className="text-[11px] text-blue-700">Desactivar para operaciones sin IGV</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIncluirIgv(!incluirIgv)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${incluirIgv ? 'bg-green-500' : 'bg-gray-300'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${incluirIgv ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>Subtotal (c/IGV)</span>
                      <span className="font-mono">{formatCurrency(subtotalBruto)}</span>
                    </div>
                    {descuentoPct > 0 && (
                      <div className="flex justify-between text-sm text-red-600">
                        <span>Descuento ({descuentoPct}%)</span>
                        <span className="font-mono">-{formatCurrency(descuentoMonto)}</span>
                      </div>
                    )}
                    {incluirIgv ? (
                      <>
                        <div className="flex justify-between text-xs text-gray-500 pt-1 border-t border-gray-200 mt-1">
                          <span>Base imponible</span>
                          <span className="font-mono">{formatCurrency(baseImponible)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>IGV (18%)</span>
                          <span className="font-mono">{formatCurrency(igvMonto)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between text-xs text-amber-700 italic">
                        <span>Sin IGV</span>
                        <span>—</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-gray-900 text-lg border-t border-gray-200 pt-1.5 mt-1.5">
                      <span>Total a pagar</span>
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
              className="w-full h-14 bg-[#FBE600] hover:bg-[#E5D100] text-black font-bold text-base rounded-xl shadow-md"
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
                <Loader2 className="w-6 h-6 animate-spin text-gray-600" />
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
