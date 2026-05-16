'use client'

import { useEffect, useState } from 'react'
import { Search, Plus, Minus, Trash2, AlertCircle, Loader2, Package, Receipt, Banknote, Smartphone, Building2, UserCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const IGV_RATE = 0.18

interface Cliente {
  id: string
  razon_social: string
  ruc: string | null
  dni: string | null
  direccion: string | null
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
}

interface ItemCarrito {
  producto: Producto
  cantidad: number
  subtotal: number
}

type ModoCliente = 'registrado' | 'consumidor_final'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}

export default function VentaDirectaDialog({ open, onOpenChange, onCreated }: Props) {
  const supabase = createClient()

  const [loadingData, setLoadingData] = useState(false)
  const [guardando, setGuardando] = useState(false)

  // Modo de cliente
  const [modoCliente, setModoCliente] = useState<ModoCliente>('registrado')

  // Cliente registrado
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [clienteSearch, setClienteSearch] = useState('')
  const debouncedCliente = useDebounce(clienteSearch, 300)
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)

  // Consumidor final
  const [externoNombre, setExternoNombre] = useState('Consumidor Final')
  const [externoDoc, setExternoDoc] = useState('')

  // Productos
  const [productos, setProductos] = useState<Producto[]>([])
  const [productoSearch, setProductoSearch] = useState('')
  const debouncedProducto = useDebounce(productoSearch, 300)
  const [showProductoDropdown, setShowProductoDropdown] = useState(false)
  const [carrito, setCarrito] = useState<ItemCarrito[]>([])

  // Datos del comprobante
  const [tipoComprobante, setTipoComprobante] = useState<'factura' | 'boleta' | 'nota_pedido_interna'>('boleta')
  const [serie, setSerie] = useState('B001')
  const [incluirIgv, setIncluirIgv] = useState(true)
  const [notas, setNotas] = useState('')

  // Métodos de pago
  const [pagoEfectivo, setPagoEfectivo] = useState('')
  const [pagoYape, setPagoYape] = useState('')
  const [pagoPlin, setPagoPlin] = useState('')
  const [pagoTransfer, setPagoTransfer] = useState('')

  // Reset al abrir
  useEffect(() => {
    if (!open) return
    setModoCliente('registrado')
    setClienteSearch('')
    setClienteSeleccionado(null)
    setExternoNombre('Consumidor Final')
    setExternoDoc('')
    setProductoSearch('')
    setCarrito([])
    setTipoComprobante('boleta')
    setSerie('B001')
    setIncluirIgv(true)
    setNotas('')
    setPagoEfectivo('')
    setPagoYape('')
    setPagoPlin('')
    setPagoTransfer('')
  }, [open])

  // Carga inicial de catálogos
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      setLoadingData(true)
      const [{ data: cls }, { data: prods }] = await Promise.all([
        supabase
          .from('clientes')
          .select('id, razon_social, ruc, dni, direccion, lista_precio_id, tipo_comprobante_preferido, estado')
          .eq('estado', 'activo')
          .order('razon_social'),
        supabase
          .from('productos')
          .select('id, codigo, nombre, descripcion, tiene_lote, tiene_vencimiento, activo')
          .eq('activo', true)
          .order('nombre'),
      ])
      if (cancelled) return
      setClientes((cls ?? []) as Cliente[])
      setProductos((prods ?? []).map((p: any) => ({
        id: p.id, codigo: p.codigo, nombre: p.nombre, descripcion: p.descripcion,
        tiene_lote: !!p.tiene_lote, tiene_vencimiento: !!p.tiene_vencimiento, precio: 0,
      })))
      setLoadingData(false)
    }
    load()
    return () => { cancelled = true }
  }, [open, supabase])

  // Filtros
  const clientesFiltrados = (() => {
    if (debouncedCliente.length < 2) return []
    const q = debouncedCliente.toLowerCase()
    return clientes.filter((c) =>
      c.razon_social.toLowerCase().includes(q) ||
      (c.ruc ?? '').toLowerCase().includes(q) ||
      (c.dni ?? '').toLowerCase().includes(q)
    ).slice(0, 8)
  })()

  const productosFiltrados = (() => {
    if (debouncedProducto.length < 2) return []
    const q = debouncedProducto.toLowerCase()
    return productos.filter((p) =>
      (p.descripcion ?? '').toLowerCase().includes(q) ||
      p.nombre.toLowerCase().includes(q) ||
      (p.codigo ?? '').toLowerCase().includes(q)
    ).slice(0, 8)
  })()

  async function seleccionarCliente(c: Cliente) {
    setClienteSeleccionado(c)
    setClienteSearch(c.razon_social)
    setShowClienteDropdown(false)
    setCarrito([])
    // Preseleccionar tipo comprobante según cliente
    const tipoPref = c.tipo_comprobante_preferido ?? (c.ruc ? 'factura' : 'boleta')
    setTipoComprobante(tipoPref as any)
    setSerie(tipoPref === 'factura' ? 'F001' : 'B001')

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
  const subtotalBruto = carrito.reduce((acc, s) => acc + s.subtotal, 0)
  const baseImponible = incluirIgv ? subtotalBruto / (1 + IGV_RATE) : subtotalBruto
  const igvMonto = incluirIgv ? subtotalBruto - baseImponible : 0
  const totalFinal = subtotalBruto

  const totalPagado = (parseFloat(pagoEfectivo) || 0) + (parseFloat(pagoYape) || 0) +
                      (parseFloat(pagoPlin) || 0) + (parseFloat(pagoTransfer) || 0)
  const diferenciaPago = totalPagado - totalFinal

  // Validación cliente puede recibir factura
  const tieneRuc = modoCliente === 'registrado'
    ? !!clienteSeleccionado?.ruc
    : !!(externoDoc && externoDoc.length === 11)

  const datosClienteValidos = modoCliente === 'registrado'
    ? !!clienteSeleccionado
    : externoNombre.trim().length >= 2

  const puedeGuardar = datosClienteValidos && carrito.length > 0
    && totalFinal > 0 && totalPagado >= totalFinal && !guardando
    && (tipoComprobante !== 'factura' || tieneRuc)

  const updateTipoComprobante = (t: string) => {
    setTipoComprobante(t as any)
    setSerie(t === 'factura' ? 'F001' : t === 'boleta' ? 'B001' : 'T001')
  }

  async function guardarVentaDirecta() {
    if (!puedeGuardar) return
    setGuardando(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData?.user?.id ?? null

      const numero = `P-${Date.now().toString().slice(-8)}`
      const clienteId = modoCliente === 'registrado' ? clienteSeleccionado!.id : null
      const externoNom = modoCliente === 'consumidor_final' ? externoNombre.trim() : null
      const externoDc = modoCliente === 'consumidor_final' && externoDoc.trim() ? externoDoc.trim() : null

      // 1. Pedido en estado 'enviado' (para luego pasar a 'entregado' y disparar el trigger de stock)
      const { data: pedido, error: pedidoError } = await (supabase.from('pedidos') as any)
        .insert({
          numero,
          cliente_id: clienteId,
          cliente_externo_nombre: externoNom,
          cliente_externo_doc: externoDc,
          vendedor_id: null,
          fecha_pedido: new Date().toISOString().split('T')[0],
          fecha_despacho: new Date().toISOString().split('T')[0],
          estado: 'enviado',
          subtotal: baseImponible,
          igv: igvMonto,
          incluir_igv: incluirIgv,
          total: totalFinal,
          descuento_porcentaje: 0,
          descuento_monto: 0,
          notas: notas.trim() || 'Venta directa desde oficina',
        })
        .select()
        .single()

      if (pedidoError || !pedido) throw new Error(pedidoError?.message ?? 'No se pudo crear el pedido')

      // 2. Asignación FEFO de lotes
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
        descuento_porcentaje: 0,
        subtotal: s.subtotal,
      }))

      const { error: itemsError } = await (supabase.from('pedidos_items') as any).insert(itemsToInsert)
      if (itemsError) {
        // rollback: borrar pedido
        await (supabase.from('pedidos') as any).delete().eq('id', pedido.id)
        throw new Error(itemsError.message)
      }

      // 3. Pasar pedido a 'entregado' ANTES de emitir comprobante.
      //    Dispara el trigger que descuenta stock + lotes + crea movimiento_stock.
      //    Si falla aquí, el comprobante aún no existe -> rollback completo.
      const { error: updErr } = await (supabase.from('pedidos') as any)
        .update({ estado: 'entregado', updated_at: new Date().toISOString() })
        .eq('id', pedido.id)
      if (updErr) {
        // rollback: borrar pedido (CASCADE borra items)
        await (supabase.from('pedidos') as any).delete().eq('id', pedido.id)
        throw new Error('Descontar stock: ' + updErr.message)
      }

      // 4. Emitir comprobante (después del trigger de stock)
      const numeroComp = Date.now().toString().slice(-8)
      const { error: compError } = await (supabase.from('comprobantes') as any).insert({
        pedido_id: pedido.id,
        cliente_id: clienteId,
        cliente_externo_nombre: externoNom,
        cliente_externo_doc: externoDc,
        facturador_id: userId,
        tipo: tipoComprobante,
        serie,
        numero: numeroComp,
        fecha_emision: new Date().toISOString().split('T')[0],
        subtotal: baseImponible,
        igv: igvMonto,
        total: totalFinal,
        moneda: 'PEN',
        estado: 'emitido',
      })
      if (compError) throw new Error('Comprobante: ' + compError.message)

      // 5. Registrar el cobro
      const { error: cobroError } = await (supabase.from('cobros') as any).insert({
        cliente_id: clienteId,
        cliente_externo_nombre: externoNom,
        cliente_externo_doc: externoDc,
        cobrador_id: userId,
        tipo: 'venta_directa' as any,
        referencia_id: pedido.id,
        fecha: new Date().toISOString().split('T')[0],
        efectivo: parseFloat(pagoEfectivo) || 0,
        yape: parseFloat(pagoYape) || 0,
        plin: parseFloat(pagoPlin) || 0,
        transferencia: parseFloat(pagoTransfer) || 0,
        total: totalPagado,
        notas: `${serie}-${numeroComp} · ${tipoComprobante}`,
      })
      // Si falla por tipo no soportado, fallback a 'cobranza'
      if (cobroError && cobroError.message.includes('tipo_cobro')) {
        await (supabase.from('cobros') as any).insert({
          cliente_id: clienteId,
          cliente_externo_nombre: externoNom,
          cliente_externo_doc: externoDc,
          cobrador_id: userId,
          tipo: 'cobranza',
          referencia_id: pedido.id,
          fecha: new Date().toISOString().split('T')[0],
          efectivo: parseFloat(pagoEfectivo) || 0,
          yape: parseFloat(pagoYape) || 0,
          plin: parseFloat(pagoPlin) || 0,
          transferencia: parseFloat(pagoTransfer) || 0,
          total: totalPagado,
          notas: `Venta directa ${serie}-${numeroComp}`,
        })
      } else if (cobroError) {
        // No interrumpir el flujo, solo notificar
        toast.warning('Cobro no registrado', { description: cobroError.message })
      }

      toast.success('Venta directa registrada', {
        description: `${serie}-${numeroComp} · ${formatCurrency(totalFinal)}`,
      })
      onCreated()
      onOpenChange(false)
    } catch (err: any) {
      toast.error('No se pudo registrar la venta', { description: err?.message })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-green-600" />
            Venta Directa
          </DialogTitle>
        </DialogHeader>

        {loadingData ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5 mt-2">
            {/* 1. Tipo de cliente */}
            <div>
              <Label className="text-sm font-semibold">1. Cliente *</Label>
              <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 mt-2 text-xs">
                <button
                  type="button"
                  onClick={() => setModoCliente('registrado')}
                  className={`px-3 py-1.5 rounded ${modoCliente === 'registrado' ? 'bg-green-600 text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  Cliente registrado
                </button>
                <button
                  type="button"
                  onClick={() => setModoCliente('consumidor_final')}
                  className={`px-3 py-1.5 rounded ${modoCliente === 'consumidor_final' ? 'bg-green-600 text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <UserCircle2 className="w-3.5 h-3.5 inline mr-1" />
                  Consumidor final
                </button>
              </div>

              {modoCliente === 'registrado' ? (
                <div className="relative mt-2">
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
                  {showClienteDropdown && clientesFiltrados.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-30 mt-1 overflow-hidden max-h-64 overflow-y-auto">
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
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {clienteSeleccionado && (
                    <div className="mt-2 p-3 bg-green-50 border border-green-100 rounded-lg">
                      <div className="font-medium text-green-900 text-sm">{clienteSeleccionado.razon_social}</div>
                      <div className="text-xs text-green-700 font-mono mt-0.5">
                        {clienteSeleccionado.ruc ? `RUC ${clienteSeleccionado.ruc}` :
                         clienteSeleccionado.dni ? `DNI ${clienteSeleccionado.dni}` : 'Sin documento'}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <Label className="text-xs">Nombre / Razón Social</Label>
                    <Input
                      value={externoNombre}
                      onChange={(e) => setExternoNombre(e.target.value)}
                      placeholder="Consumidor Final"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">DNI / RUC (opcional)</Label>
                    <Input
                      value={externoDoc}
                      onChange={(e) => setExternoDoc(e.target.value.replace(/\D/g, '').slice(0, 11))}
                      placeholder="DNI o RUC"
                      className="mt-1 font-mono"
                      inputMode="numeric"
                      maxLength={11}
                    />
                    <p className="text-[10px] text-gray-400 mt-1">RUC (11 dígitos) habilita emisión de factura.</p>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Productos */}
            <div className="border-t border-gray-100 pt-4">
              <Label className="text-sm font-semibold">2. Productos *</Label>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Buscar producto por nombre o código..."
                  value={productoSearch}
                  onChange={(e) => { setProductoSearch(e.target.value); setShowProductoDropdown(true) }}
                  onFocus={() => setShowProductoDropdown(true)}
                  disabled={!datosClienteValidos}
                  className="pl-9"
                />
                {showProductoDropdown && productosFiltrados.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-30 mt-1 overflow-hidden max-h-64 overflow-y-auto">
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
                        <div className="text-green-700 font-semibold text-sm shrink-0">{formatCurrency(p.precio)}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {carrito.length === 0 ? (
                <div className="text-center py-6 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg mt-2">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Agrega productos a la venta</p>
                  {!datosClienteValidos && <p className="text-[11px] mt-1">Completa los datos del cliente primero</p>}
                </div>
              ) : (
                <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Producto</th>
                        <th className="text-center py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase">Cant.</th>
                        <th className="text-right py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase">P. Unit.</th>
                        <th className="text-right py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Subtotal</th>
                        <th className="py-2 px-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {carrito.map(({ producto, cantidad, subtotal }) => (
                        <tr key={producto.id}>
                          <td className="py-2 px-3">
                            <div className="font-medium text-gray-900 text-sm truncate max-w-[260px]">
                              {producto.descripcion?.trim() || producto.nombre}
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono">{producto.codigo}</div>
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex items-center justify-center gap-1.5">
                              <button type="button" onClick={() => cambiarCantidad(producto.id, -1)}
                                className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 flex items-center justify-center">
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="font-semibold w-8 text-center text-sm">{cantidad}</span>
                              <button type="button" onClick={() => cambiarCantidad(producto.id, 1)}
                                className="w-6 h-6 rounded bg-[#FBE600] hover:bg-[#E5D100] flex items-center justify-center">
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
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 3. Comprobante */}
            {carrito.length > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <Label className="text-sm font-semibold">3. Comprobante</Label>
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <div>
                    <Label className="text-xs">Tipo</Label>
                    <Select value={tipoComprobante} onValueChange={updateTipoComprobante}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="factura" disabled={!tieneRuc}>
                          Factura {!tieneRuc && '(requiere RUC)'}
                        </SelectItem>
                        <SelectItem value="boleta">Boleta</SelectItem>
                        <SelectItem value="nota_pedido_interna">Doc. Interno</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Serie</Label>
                    <Input value={serie} onChange={(e) => setSerie(e.target.value.toUpperCase())} maxLength={4} className="mt-1 font-mono" />
                  </div>
                  <div className="flex items-end justify-between bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-xs font-medium text-blue-900">Aplica IGV (18%)</p>
                      <p className="text-[10px] text-blue-700">Precios incluyen/no IGV</p>
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

                {/* Totales */}
                <div className="bg-gray-50 rounded-lg p-4 space-y-1.5 mt-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Subtotal {incluirIgv && '(sin IGV)'}</span>
                    <span className="font-medium">{formatCurrency(baseImponible)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">IGV (18%){!incluirIgv && <span className="text-amber-600 text-xs ml-1">· desactivado</span>}</span>
                    <span className="font-medium">{formatCurrency(igvMonto)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2 mt-1">
                    <span>Total a pagar</span>
                    <span className="text-green-600">{formatCurrency(totalFinal)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* 4. Métodos de pago */}
            {carrito.length > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <Label className="text-sm font-semibold">4. Cobro inmediato</Label>
                <p className="text-[11px] text-gray-500 mt-0.5">Distribuye el pago en los métodos usados.</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                  <div>
                    <Label className="text-xs flex items-center gap-1"><Banknote className="w-3 h-3" /> Efectivo</Label>
                    <Input type="number" min={0} step="0.01" placeholder="0.00"
                      value={pagoEfectivo} onChange={(e) => setPagoEfectivo(e.target.value)}
                      className="mt-1 h-9 font-mono" />
                  </div>
                  <div>
                    <Label className="text-xs flex items-center gap-1"><Smartphone className="w-3 h-3 text-purple-500" /> Yape</Label>
                    <Input type="number" min={0} step="0.01" placeholder="0.00"
                      value={pagoYape} onChange={(e) => setPagoYape(e.target.value)}
                      className="mt-1 h-9 font-mono" />
                  </div>
                  <div>
                    <Label className="text-xs flex items-center gap-1"><Smartphone className="w-3 h-3 text-blue-500" /> Plin</Label>
                    <Input type="number" min={0} step="0.01" placeholder="0.00"
                      value={pagoPlin} onChange={(e) => setPagoPlin(e.target.value)}
                      className="mt-1 h-9 font-mono" />
                  </div>
                  <div>
                    <Label className="text-xs flex items-center gap-1"><Building2 className="w-3 h-3" /> Transferencia</Label>
                    <Input type="number" min={0} step="0.01" placeholder="0.00"
                      value={pagoTransfer} onChange={(e) => setPagoTransfer(e.target.value)}
                      className="mt-1 h-9 font-mono" />
                  </div>
                </div>

                <div className={`mt-3 rounded-lg px-3 py-2 flex justify-between text-sm font-medium ${
                  totalPagado >= totalFinal
                    ? 'bg-green-50 border border-green-200 text-green-800'
                    : 'bg-amber-50 border border-amber-200 text-amber-800'
                }`}>
                  <span>Total pagado</span>
                  <span>
                    {formatCurrency(totalPagado)}
                    {diferenciaPago !== 0 && (
                      <span className="ml-2 text-xs">
                        {diferenciaPago > 0 ? `(vuelto: ${formatCurrency(diferenciaPago)})` : `(falta: ${formatCurrency(-diferenciaPago)})`}
                      </span>
                    )}
                  </span>
                </div>

                <div className="mt-3">
                  <Label className="text-xs">Notas (opcional)</Label>
                  <Input value={notas} onChange={(e) => setNotas(e.target.value)}
                    placeholder="Observaciones..." className="mt-1 h-9" />
                </div>
              </div>
            )}

            {tipoComprobante === 'factura' && !tieneRuc && (
              <div className="flex items-center gap-1.5 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">Para emitir factura el cliente debe tener RUC válido (11 dígitos).</span>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
              <Button
                onClick={guardarVentaDirecta}
                disabled={!puedeGuardar}
                className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
              >
                {guardando && <Loader2 className="w-4 h-4 animate-spin" />}
                <Receipt className="w-4 h-4" />
                Emitir y cobrar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
