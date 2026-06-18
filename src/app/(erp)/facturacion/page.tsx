'use client'

import { useEffect, useState, useCallback } from 'react'
import { FileText, Loader2, CheckCircle, AlertCircle, DollarSign, Receipt, Eye, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import VentaDirectaDialog from './venta-directa-dialog'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { puedeEmitirFactura, serieDeTipoComprobante, tipoComprobanteSugerido } from '@/lib/cliente-utils'

const ESTADO_SUNAT: Record<string, { label: string; className: string }> = {
  emitido: { label: 'Emitido', className: 'bg-blue-100 text-blue-700' },
  enviado_sunat: { label: 'Enviado SUNAT', className: 'bg-yellow-100 text-yellow-700' },
  aceptado: { label: 'Aceptado', className: 'bg-green-100 text-green-700' },
  rechazado: { label: 'Rechazado', className: 'bg-red-100 text-red-700' },
  anulado: { label: 'Anulado', className: 'bg-gray-100 text-gray-500' },
}

export default function FacturacionPage() {
  const supabase = createClient()

  const [pedidosPendientes, setPedidosPendientes] = useState<any[]>([])
  const [comprobantes, setComprobantes] = useState<any[]>([])
  const [userRole, setUserRole] = useState<string | null>(null)
  // Impresión por rangos
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [filtroDesde, setFiltroDesde] = useState<string>('')
  const [filtroHasta, setFiltroHasta] = useState<string>('')
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'factura' | 'boleta' | 'nota_pedido_interna'>('todos')
  // Edición controlada
  const [editarOpen, setEditarOpen] = useState(false)
  const [editComp, setEditComp] = useState<any>(null)
  const [editItems, setEditItems] = useState<any[]>([])
  const [editHistorial, setEditHistorial] = useState<any[]>([])
  const [editNota, setEditNota] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tipoCambio, setTipoCambio] = useState<number | null>(null)
  const [tipoCambioFecha, setTipoCambioFecha] = useState<string | null>(null)
  const [facturarDialog, setFacturarDialog] = useState(false)
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState<any>(null)
  const [tipoComprobante, setTipoComprobante] = useState<string>('factura')
  const [serie, setSerie] = useState('F001')
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [ventaDirectaOpen, setVentaDirectaOpen] = useState(false)
  const [comprobanteEmitidoId, setComprobanteEmitidoId] = useState<string | null>(null)
  const [comprobanteEmitidoLabel, setComprobanteEmitidoLabel] = useState<string>('')
  const [emisionLoteActiva, setEmisionLoteActiva] = useState<string | null>(null)
  const [progresoLote, setProgresoLote] = useState<{ actual: number; total: number; exitosos: number; fallos: number } | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)

    const [{ data: pedidos }, { data: comp }, { data: tc }] = await Promise.all([
      (supabase as any)
        .from('pedidos')
        .select(`
          id, numero, subtotal, igv, incluir_igv, total, estado, created_at, cliente_id,
          fecha_pedido, fecha_despacho, solicitud_mayorista, lista_precio_aplicada, notas,
          clientes(razon_social, ruc, dni, tipo_comprobante_preferido, credito_dias, lista_precio_id)
        `)
        .eq('estado', 'enviado')
        .order('created_at', { ascending: true }),
      supabase
        .from('comprobantes')
        .select(`
          id, serie, numero, tipo, fecha_emision, total, estado, editado, editado_at, enviado_sunat,
          clientes(razon_social)
        `)
        .order('fecha_emision', { ascending: false })
        .limit(200),
      // TC más reciente disponible (si hoy no hay, usa el último día hábil)
      supabase
        .from('tipo_cambio')
        .select('fecha, compra, venta')
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    setPedidosPendientes(pedidos ?? [])
    setComprobantes(comp ?? [])
    if (tc) {
      setTipoCambio(Number(tc.venta ?? 0) || null)
      setTipoCambioFecha(tc.fecha ?? null)
    } else {
      setTipoCambio(null)
      setTipoCambioFecha(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Refresco en tiempo real: cuando un vendedor crea un pedido o se emite/edita
  // un comprobante, la página se actualiza sola sin recargar.
  useEffect(() => {
    const channel = supabase
      .channel('facturacion-realtime')
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'pedidos' }, () => loadData())
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'comprobantes' }, () => loadData())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [supabase, loadData])

  // Cargar rol del usuario para gating de edición (solo admin/gerente/facturador editan)
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !active) return
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      if (active) setUserRole((prof as any)?.role ?? null)
    })()
    return () => { active = false }
  }, [supabase])

  const puedeEditar = userRole === 'administrador' || userRole === 'gerente' || userRole === 'facturador'

  // Filtrar comprobantes según rango de fechas + tipo
  const comprobantesFiltrados = comprobantes.filter((c: any) => {
    if (filtroTipo !== 'todos' && c.tipo !== filtroTipo) return false
    if (filtroDesde && c.fecha_emision < filtroDesde) return false
    if (filtroHasta && c.fecha_emision > filtroHasta) return false
    return true
  })

  function toggleSeleccion(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function seleccionarTodos() {
    setSeleccionados(new Set(comprobantesFiltrados.map((c: any) => c.id)))
  }
  function limpiarSeleccion() {
    setSeleccionados(new Set())
  }
  function imprimirLote(formato: 'a4' | 'ticket') {
    if (seleccionados.size === 0) {
      toast.error('Sin comprobantes seleccionados', { description: 'Marca al menos uno para imprimir en lote.' })
      return
    }
    const ids = Array.from(seleccionados).join(',')
    window.open(`/comprobante/imprimir-lote?ids=${ids}&formato=${formato}`, '_blank')
  }

  async function abrirEditar(comp: any) {
    if (!puedeEditar) {
      toast.error('Sin permisos', { description: 'Solo administrador, gerente o facturador pueden editar comprobantes.' })
      return
    }
    if (comp.enviado_sunat) {
      toast.error('Bloqueado', { description: 'El comprobante ya fue enviado a SUNAT y no puede editarse.' })
      return
    }
    setEditComp(comp)
    setEditNota('')
    setEditarOpen(true)
    // Cargar items + historial
    const [{ data: items }, { data: hist }] = await Promise.all([
      supabase.from('comprobantes_items')
        .select('id, descripcion, cantidad, precio_unitario, subtotal, igv_porcentaje, productos(codigo, nombre)')
        .eq('comprobante_id', comp.id)
        .order('id'),
      (supabase as any).from('comprobantes_ediciones')
        .select('id, usuario_nombre, usuario_rol, campo, valor_anterior, valor_nuevo, item_descripcion, nota, created_at')
        .eq('comprobante_id', comp.id)
        .order('created_at', { ascending: false }),
    ])
    setEditItems((items ?? []).map((it: any) => ({ ...it, _cantidad: String(it.cantidad), _precio: String(it.precio_unitario) })))
    setEditHistorial(hist ?? [])
  }

  async function guardarEdicion() {
    if (!editComp) return
    setEditSaving(true)
    try {
      let cambios = 0
      for (const it of editItems) {
        const cantNueva = parseFloat(it._cantidad)
        const precioNueva = parseFloat(it._precio)
        const descNueva = (it.descripcion ?? '').trim()
        if (isNaN(cantNueva) || cantNueva <= 0 || isNaN(precioNueva) || precioNueva < 0 || !descNueva) {
          throw new Error(`Item "${it.descripcion}": cantidad y precio deben ser válidos, descripción no puede estar vacía.`)
        }
        const cambioCant = Number(it.cantidad) !== cantNueva
        const cambioPrecio = Number(it.precio_unitario) !== precioNueva
        const cambioDesc = it.descripcion !== descNueva
        if (!cambioCant && !cambioPrecio && !cambioDesc) continue
        const { error } = await (supabase.rpc as any)('editar_comprobante_item', {
          p_item_id: it.id,
          p_descripcion: descNueva,
          p_cantidad: cantNueva,
          p_precio_unitario: precioNueva,
          p_nota: editNota.trim() || null,
        })
        if (error) throw new Error(error.message)
        cambios++
      }
      if (cambios === 0) {
        toast.info('Sin cambios', { description: 'No modificaste ningún campo.' })
      } else {
        toast.success(`Comprobante actualizado`, {
          description: `${cambios} línea${cambios === 1 ? '' : 's'} modificada${cambios === 1 ? '' : 's'}. Los totales se recalcularon.`,
        })
        setEditarOpen(false)
        loadData()
      }
    } catch (err: any) {
      toast.error('No se pudo guardar', { description: err?.message ?? 'Error desconocido' })
    } finally {
      setEditSaving(false)
    }
  }

  const handleFacturar = (pedido: any) => {
    setPedidoSeleccionado(pedido)
    const cliente = pedido.clientes ?? {}
    // Usar tipo_comprobante_preferido del cliente, con fallback a regla SUNAT
    const tipo = cliente.tipo_comprobante_preferido ?? tipoComprobanteSugerido(cliente)
    setTipoComprobante(tipo)
    setSerie(serieDeTipoComprobante(tipo))
    setFacturarDialog(true)
  }

  // Determinar tipo de comprobante de un pedido (regla SUNAT + preferencia del cliente)
  const tipoPedido = (pedido: any): 'factura' | 'boleta' | 'nota_pedido_interna' => {
    const cli = pedido.clientes ?? {}
    const t = cli.tipo_comprobante_preferido ?? tipoComprobanteSugerido(cli)
    if (t === 'factura') return 'factura'
    if (t === 'nota_pedido_interna') return 'nota_pedido_interna'
    return 'boleta'
  }

  // Función reutilizable: emite UN comprobante para UN pedido vía RPC atómica.
  // La RPC valida que el pedido tenga items y hace todo en una transacción
  // (cabecera + items snapshot + cambio de estado). Si falla, rollback completo.
  // Esto elimina el bug histórico de comprobantes con monto pero sin detalle.
  const emitirComprobantePedido = async (pedido: any, tipo: 'factura' | 'boleta' | 'nota_pedido_interna') => {
    // 1) Correlativo
    const { data: corr, error: corrErr } = await (supabase.rpc as any)('siguiente_correlativo', { p_tipo: tipo })
    if (corrErr || !corr || corr.length === 0) {
      throw new Error(corrErr?.message ?? 'Falta configurar la numeración.')
    }
    const serieReal = corr[0].serie as string
    const numero = corr[0].numero as string

    // 2) Totales
    const pedSubtotal = Number(pedido.subtotal ?? 0)
    const pedIgv = Number(pedido.igv ?? 0)
    const pedTotal = Number(pedido.total ?? 0)
    const incluirIgv = pedido.incluir_igv !== false
    const igvCalc = pedIgv > 0 ? pedIgv : (incluirIgv ? pedTotal * 0.18 / 1.18 : 0)
    const subtotalCalc = pedIgv > 0 ? pedSubtotal : (incluirIgv ? pedTotal - igvCalc : pedTotal)

    // 3) Usuario actual (para facturador_id)
    const { data: { user } } = await supabase.auth.getUser()

    // 4) Llamar RPC atómica
    const { data: result, error: rpcError } = await (supabase.rpc as any)('emitir_comprobante_atomico', {
      p_pedido_id: pedido.id,
      p_tipo: tipo,
      p_serie: serieReal,
      p_numero: numero,
      p_fecha_emision: hoyLima(),
      p_subtotal: subtotalCalc,
      p_igv: igvCalc,
      p_total: pedTotal > 0 ? pedTotal : subtotalCalc + igvCalc,
      p_facturador_id: user?.id ?? null,
    })
    if (rpcError) throw new Error(rpcError.message)
    if (!result?.id) throw new Error('La emisión no devolvió un comprobante válido.')

    return { id: result.id, label: `${serieReal}-${numero}` }
  }

  // Emisión MASIVA por tipo
  const emitirLote = async (tipo: 'factura' | 'boleta' | 'nota_pedido_interna') => {
    const pedidosDelTipo = pedidosPendientes.filter((p) => tipoPedido(p) === tipo)
    if (pedidosDelTipo.length === 0) return

    const tipoLabel = tipo === 'factura' ? 'facturas' : tipo === 'boleta' ? 'boletas' : 'documentos internos'
    if (!confirm(`¿Emitir ${pedidosDelTipo.length} ${tipoLabel} en lote? El correlativo se asignará automáticamente a cada una.`)) return

    setEmisionLoteActiva(tipo)
    setProgresoLote({ actual: 0, total: pedidosDelTipo.length, exitosos: 0, fallos: 0 })

    let exitosos = 0
    let fallos = 0
    const errores: string[] = []

    for (let i = 0; i < pedidosDelTipo.length; i++) {
      const p = pedidosDelTipo[i]
      try {
        await emitirComprobantePedido(p, tipo)
        exitosos++
      } catch (err: any) {
        fallos++
        errores.push(`${p.numero}: ${err?.message ?? 'desconocido'}`)
      }
      setProgresoLote({ actual: i + 1, total: pedidosDelTipo.length, exitosos, fallos })
    }

    setEmisionLoteActiva(null)
    if (fallos === 0) {
      toast.success(`${exitosos} ${tipoLabel} emitidos correctamente`)
    } else {
      toast.warning(`Lote terminado: ${exitosos} emitidos, ${fallos} con error`, {
        description: errores.slice(0, 3).join(' · ') + (errores.length > 3 ? ` y ${errores.length - 3} más` : ''),
        duration: 8000,
      })
    }
    setTimeout(() => setProgresoLote(null), 5000)
    loadData()
  }

  const confirmarFacturacion = async () => {
    if (!pedidoSeleccionado) return
    setSaving(true)

    // Obtener correlativo atómico desde la BD (serie + número)
    const { data: corr, error: corrErr } = await (supabase.rpc as any)('siguiente_correlativo', { p_tipo: tipoComprobante })
    if (corrErr || !corr || corr.length === 0) {
      setSaving(false)
      toast.error('Falta configurar numeración', {
        description: corrErr?.message ?? 'Ve a Configuración → Numeración de Comprobantes.',
      })
      return
    }
    const serieReal = corr[0].serie as string
    const numero = corr[0].numero as string

    // Respetar incluir_igv del pedido. Si el pedido ya tiene IGV calculado, usarlo directamente.
    const pedSubtotal = Number(pedidoSeleccionado.subtotal ?? 0)
    const pedIgv = Number(pedidoSeleccionado.igv ?? 0)
    const pedTotal = Number(pedidoSeleccionado.total ?? 0)
    const incluirIgv = pedidoSeleccionado.incluir_igv !== false
    // Si el pedido no tiene igv pero incluir_igv=true, calcular a partir del total (legacy)
    const igvCalc = pedIgv > 0 ? pedIgv : (incluirIgv ? pedTotal * 0.18 / 1.18 : 0)
    const subtotalCalc = pedIgv > 0 ? pedSubtotal : (incluirIgv ? pedTotal - igvCalc : pedTotal)

    // Usar RPC atómica: cabecera + items + cambio estado en una transacción
    const { data: { user } } = await supabase.auth.getUser()
    const { data: result, error: rpcError } = await (supabase.rpc as any)('emitir_comprobante_atomico', {
      p_pedido_id: pedidoSeleccionado.id,
      p_tipo: tipoComprobante,
      p_serie: serieReal,
      p_numero: numero,
      p_fecha_emision: hoyLima(),
      p_subtotal: subtotalCalc,
      p_igv: igvCalc,
      p_total: pedTotal > 0 ? pedTotal : subtotalCalc + igvCalc,
      p_facturador_id: user?.id ?? null,
    })

    setSaving(false)
    if (rpcError || !result?.id) {
      toast.error('Error al emitir comprobante', { description: rpcError?.message ?? 'No se generó el comprobante' })
      return
    }
    setFacturarDialog(false)
    const compInsertado = { id: result.id as string }

    const label = `${serieReal}-${numero}`
    const totalFmt = (pedTotal > 0 ? pedTotal : subtotalCalc + igvCalc).toLocaleString('es-PE', { style: 'currency', currency: 'PEN' })
    // Calcular fecha de vencimiento (si el cliente tiene credito_dias)
    const creditoDias = (pedidoSeleccionado.clientes as any)?.credito_dias ?? 0
    const vence = (() => {
      const d = new Date()
      d.setDate(d.getDate() + Number(creditoDias))
      return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    })()
    const mensaje = `✅ ${label} emitido · ${totalFmt} agregado a cobranzas del cliente${creditoDias > 0 ? ` · Vence el ${vence}` : ''}`
    setSuccessMsg(mensaje)
    setComprobanteEmitidoId(compInsertado?.id ?? null)
    setComprobanteEmitidoLabel(label)
    toast.success('Comprobante emitido · Cuenta por cobrar generada', { description: mensaje, duration: 6000 })
    setTimeout(() => { setSuccessMsg(''); setComprobanteEmitidoId(null) }, 10000)
    loadData()
  }

  const updateSerie = (tipo: string) => {
    setTipoComprobante(tipo)
    setSerie(tipo === 'factura' ? 'F001' : tipo === 'boleta' ? 'B001' : 'T001')
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Facturación</h1>
          <p className="text-sm text-gray-500 mt-0.5">Emisión de comprobantes electrónicos</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5"
            title={tipoCambioFecha ? `Tipo de cambio del ${formatDate(tipoCambioFecha)}` : 'Sin tipo de cambio registrado'}>
            <DollarSign className="w-4 h-4 text-blue-500" />
            <span className="text-sm text-blue-700 font-medium">
              T/C: {tipoCambio != null ? `S/ ${tipoCambio.toFixed(3)}` : '—'}
            </span>
            {tipoCambioFecha && (
              <span className="text-[10px] text-blue-500/70 font-mono">
                {formatDate(tipoCambioFecha)}
              </span>
            )}
          </div>
          <Button
            onClick={() => setVentaDirectaOpen(true)}
            className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
          >
            <Receipt className="w-4 h-4" /> Venta Directa
          </Button>
        </div>
      </div>

      <VentaDirectaDialog
        open={ventaDirectaOpen}
        onOpenChange={setVentaDirectaOpen}
        onCreated={loadData}
      />

      {successMsg && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            <p className="text-sm text-green-800 font-medium">{successMsg}</p>
          </div>
          {comprobanteEmitidoId && (
            <Link
              href={`/comprobante/${comprobanteEmitidoId}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 bg-white border border-green-300 text-green-700 hover:bg-green-100 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              Ver {comprobanteEmitidoLabel}
              <ExternalLink className="w-3 h-3 opacity-60" />
            </Link>
          )}
        </div>
      )}

      <Tabs defaultValue="pendientes">
        <TabsList className="bg-gray-100 p-1 rounded-xl">
          <TabsTrigger value="pendientes" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
            Pedidos Pendientes
            {pedidosPendientes.length > 0 && (
              <span className="ml-2 bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                {pedidosPendientes.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="emitidos" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
            Comprobantes Emitidos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pendientes" className="mt-4 space-y-4">
          {/* Botones de emisión masiva por tipo */}
          {(() => {
            const facturas = pedidosPendientes.filter((p) => tipoPedido(p) === 'factura')
            const boletas = pedidosPendientes.filter((p) => tipoPedido(p) === 'boleta')
            const internos = pedidosPendientes.filter((p) => tipoPedido(p) === 'nota_pedido_interna')
            if (pedidosPendientes.length === 0) return null

            return (
              <Card className="border-blue-200 bg-blue-50/40 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-sm font-bold text-blue-900">📦 Emisión masiva por tipo</h3>
                      <p className="text-xs text-blue-700 mt-0.5">
                        Procesa todos los pedidos del tipo seleccionado en lote. El correlativo se asigna automáticamente y de forma secuencial a cada uno.
                      </p>
                    </div>
                    {progresoLote && (
                      <div className="text-xs text-blue-800 bg-white border border-blue-200 rounded px-3 py-1.5">
                        <strong>{progresoLote.actual}</strong> / {progresoLote.total} ·
                        ✅ {progresoLote.exitosos} ·
                        {progresoLote.fallos > 0 && <span className="text-red-600"> ❌ {progresoLote.fallos}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button
                      onClick={() => emitirLote('factura')}
                      disabled={facturas.length === 0 || !!emisionLoteActiva}
                      className="bg-purple-600 hover:bg-purple-700 text-white font-semibold gap-2"
                      size="sm"
                    >
                      {emisionLoteActiva === 'factura' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                      Emitir {facturas.length} {facturas.length === 1 ? 'factura' : 'facturas'}
                    </Button>
                    <Button
                      onClick={() => emitirLote('boleta')}
                      disabled={boletas.length === 0 || !!emisionLoteActiva}
                      className="bg-green-600 hover:bg-green-700 text-white font-semibold gap-2"
                      size="sm"
                    >
                      {emisionLoteActiva === 'boleta' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                      Emitir {boletas.length} {boletas.length === 1 ? 'boleta' : 'boletas'}
                    </Button>
                    <Button
                      onClick={() => emitirLote('nota_pedido_interna')}
                      disabled={internos.length === 0 || !!emisionLoteActiva}
                      className="bg-gray-600 hover:bg-gray-700 text-white font-semibold gap-2"
                      size="sm"
                    >
                      {emisionLoteActiva === 'nota_pedido_interna' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                      Emitir {internos.length} {internos.length === 1 ? 'doc. interno' : 'docs. internos'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })()}

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">
                Pedidos listos para facturar ({pedidosPendientes.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
                </div>
              ) : pedidosPendientes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <CheckCircle className="w-10 h-10 mb-3 text-green-300" />
                  <p className="text-sm">No hay pedidos pendientes de facturar</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50/50">
                      <tr>
                        {['N°', 'Tipo', 'Cliente', 'RUC / DNI', 'F. Pedido', 'F. Despacho', 'Total', 'Acción'].map((h) => (
                          <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {pedidosPendientes.map((pedido) => {
                        const t = tipoPedido(pedido)
                        const tipoCfg = t === 'factura'
                          ? { label: 'Factura', cls: 'bg-purple-50 text-purple-700 border-purple-200' }
                          : t === 'boleta'
                            ? { label: 'Boleta', cls: 'bg-green-50 text-green-700 border-green-200' }
                            : { label: 'Doc. Interno', cls: 'bg-gray-100 text-gray-700 border-gray-200' }
                        return (
                        <tr key={pedido.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-3 px-4 font-mono text-xs text-gray-600">{pedido.numero}</td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${tipoCfg.cls}`}>
                              {tipoCfg.label}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-medium text-gray-900">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{pedido.clientes?.razon_social ?? '—'}</span>
                              {pedido.solicitud_mayorista && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 border border-orange-300"
                                  title="El vendedor solicitó tratar este pedido con precios MAYORISTA. Verificar antes de facturar."
                                >
                                  🏭 SOLICITUD MAYORISTA
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-gray-500 font-mono text-xs">
                            {pedido.clientes?.ruc ?? pedido.clientes?.dni ?? '—'}
                          </td>
                          <td className="py-3 px-4 text-gray-500 text-xs">
                            {pedido.fecha_pedido ? formatDate(pedido.fecha_pedido) : formatDate(pedido.created_at)}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            {pedido.fecha_despacho ? (
                              <span className="font-semibold text-blue-700">{formatDate(pedido.fecha_despacho)}</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-semibold text-gray-800">{formatCurrency(pedido.total ?? 0)}</td>
                          <td className="py-3 px-4">
                            <Button
                              size="sm"
                              onClick={() => handleFacturar(pedido)}
                              className="h-7 bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold text-xs gap-1"
                            >
                              <FileText className="w-3.5 h-3.5" /> Facturar
                            </Button>
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
        </TabsContent>

        <TabsContent value="emitidos" className="mt-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800 flex items-center justify-between flex-wrap gap-2">
                <span>Comprobantes Emitidos</span>
                <span className="text-xs font-normal text-gray-500">
                  {seleccionados.size > 0 ? `${seleccionados.size} seleccionado${seleccionados.size === 1 ? '' : 's'} · ` : ''}
                  {comprobantesFiltrados.length} mostrados
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Barra de filtros + acciones por lote */}
              <div className="px-4 pb-3 border-b border-gray-100 flex flex-wrap items-end gap-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wide text-gray-500">Desde</Label>
                  <Input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} className="h-8 text-xs w-36" />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wide text-gray-500">Hasta</Label>
                  <Input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} className="h-8 text-xs w-36" />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wide text-gray-500">Tipo</Label>
                  <select
                    value={filtroTipo}
                    onChange={(e) => setFiltroTipo(e.target.value as any)}
                    className="h-8 text-xs px-2 border border-gray-300 rounded-md bg-white"
                  >
                    <option value="todos">Todos</option>
                    <option value="factura">Facturas</option>
                    <option value="boleta">Boletas</option>
                    <option value="nota_pedido_interna">Internos</option>
                  </select>
                </div>
                <div className="flex-1" />
                <Button variant="outline" size="sm" onClick={seleccionarTodos} disabled={comprobantesFiltrados.length === 0} className="text-xs h-8">
                  Seleccionar todos
                </Button>
                {seleccionados.size > 0 && (
                  <Button variant="outline" size="sm" onClick={limpiarSeleccion} className="text-xs h-8">
                    Limpiar
                  </Button>
                )}
                <Button
                  onClick={() => imprimirLote('a4')}
                  disabled={seleccionados.size === 0}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 gap-1"
                >
                  🖨️ Imprimir A4 ({seleccionados.size})
                </Button>
                <Button
                  onClick={() => imprimirLote('ticket')}
                  disabled={seleccionados.size === 0}
                  size="sm"
                  className="bg-gray-700 hover:bg-gray-800 text-white text-xs h-8 gap-1"
                >
                  🧾 Imprimir Tickets ({seleccionados.size})
                </Button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
                </div>
              ) : comprobantesFiltrados.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-sm">
                  {comprobantes.length === 0 ? 'No hay comprobantes emitidos' : 'Ningún comprobante coincide con los filtros'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50/50">
                      <tr>
                        <th className="w-10 py-3 px-3">
                          <input
                            type="checkbox"
                            checked={comprobantesFiltrados.length > 0 && seleccionados.size === comprobantesFiltrados.length}
                            onChange={() => seleccionados.size === comprobantesFiltrados.length ? limpiarSeleccion() : seleccionarTodos()}
                            className="rounded"
                          />
                        </th>
                        {['Serie-Número', 'Tipo', 'Cliente', 'Fecha', 'Total', 'Estado', 'Acciones'].map((h) => (
                          <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {comprobantesFiltrados.map((c) => {
                        const estadoCfg = ESTADO_SUNAT[c.estado] ?? ESTADO_SUNAT.emitido
                        const isSel = seleccionados.has(c.id)
                        return (
                          <tr key={c.id} className={`transition-colors ${isSel ? 'bg-blue-50/40' : 'hover:bg-gray-50/50'}`}>
                            <td className="py-3 px-3">
                              <input
                                type="checkbox"
                                checked={isSel}
                                onChange={() => toggleSeleccion(c.id)}
                                className="rounded"
                              />
                            </td>
                            <td className="py-3 px-4 font-mono text-xs font-semibold">
                              <Link
                                href={`/comprobante/${c.id}`}
                                target="_blank"
                                className="text-green-700 hover:text-green-800 hover:underline"
                                title="Ver / imprimir comprobante"
                              >
                                {c.serie}-{c.numero}
                              </Link>
                              {c.editado && (
                                <span
                                  className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200"
                                  title={c.editado_at ? `Editado el ${formatDate(c.editado_at)}` : 'Comprobante editado'}
                                >
                                  ⚠ EDITADO
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 capitalize text-xs text-gray-600">{c.tipo}</td>
                            <td className="py-3 px-4 text-gray-800">{(c.clientes as any)?.razon_social ?? '—'}</td>
                            <td className="py-3 px-4 text-gray-500 text-xs">{formatDate(c.fecha_emision)}</td>
                            <td className="py-3 px-4 font-semibold text-gray-800">{formatCurrency(c.total ?? 0)}</td>
                            <td className="py-3 px-4">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${estadoCfg.className}`}>
                                {estadoCfg.label}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1">
                                <Link
                                  href={`/comprobante/${c.id}`}
                                  target="_blank"
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                                  title="Ver / imprimir"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  Ver
                                </Link>
                                {puedeEditar && !c.enviado_sunat && (
                                  <button
                                    type="button"
                                    onClick={() => abrirEditar(c)}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-700 hover:text-amber-900 hover:bg-amber-50 rounded transition-colors"
                                    title="Editar comprobante (con auditoría)"
                                  >
                                    ✏️ Editar
                                  </button>
                                )}
                              </div>
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
        </TabsContent>
      </Tabs>

      {/* Dialog Facturar */}
      <Dialog open={facturarDialog} onOpenChange={setFacturarDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Emitir Comprobante</DialogTitle>
          </DialogHeader>
          {pedidoSeleccionado && (
            <div className="space-y-4 mt-2">
              {/* Aviso de solicitud mayorista — siempre arriba del todo */}
              {pedidoSeleccionado.solicitud_mayorista && (
                <div className="bg-orange-50 border-2 border-orange-300 rounded-lg p-3 text-xs">
                  <div className="flex items-start gap-2">
                    <span className="text-lg">🏭</span>
                    <div className="flex-1">
                      <p className="font-bold text-orange-900">
                        Solicitud de precio MAYORISTA
                      </p>
                      <p className="text-orange-800 mt-1 leading-snug">
                        El vendedor solicitó tratar este pedido con precios de lista <strong>MAYORISTA</strong>,
                        aunque el cliente esté registrado normalmente en otra lista.
                      </p>
                      <p className="text-orange-700 mt-1 text-[10px] italic">
                        Verifica los precios antes de facturar. Si no apruebas, contacta al vendedor o ajusta los precios editando el pedido.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <div className="bg-gray-50 rounded-lg p-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Pedido:</span>
                  <span className="font-mono font-semibold">{pedidoSeleccionado.numero}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Cliente:</span>
                  <span className="font-medium">{pedidoSeleccionado.clientes?.razon_social}</span>
                </div>
                {(() => {
                  const st = Number(pedidoSeleccionado.subtotal ?? 0)
                  const ig = Number(pedidoSeleccionado.igv ?? 0)
                  const tt = Number(pedidoSeleccionado.total ?? 0)
                  const incIgv = pedidoSeleccionado.incluir_igv !== false
                  return (
                    <>
                      <div className="border-t border-gray-200 pt-1.5 mt-1.5" />
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>Subtotal</span><span className="font-mono">{formatCurrency(st > 0 ? st : tt / (incIgv ? 1.18 : 1))}</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>IGV (18%) {!incIgv && <span className="text-amber-600">· desactivado</span>}</span>
                        <span className="font-mono">{formatCurrency(ig > 0 ? ig : (incIgv ? tt - tt / 1.18 : 0))}</span>
                      </div>
                      <div className="flex justify-between border-t border-gray-200 pt-1.5 mt-1">
                        <span className="font-semibold">Total:</span>
                        <span className="font-bold text-green-600">{formatCurrency(tt)}</span>
                      </div>
                    </>
                  )
                })()}
              </div>

              <div>
                <Label>Tipo de Comprobante</Label>
                <Select value={tipoComprobante} onValueChange={updateSerie}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="factura" disabled={!puedeEmitirFactura(pedidoSeleccionado.clientes ?? {})}>
                      Factura {!puedeEmitirFactura(pedidoSeleccionado.clientes ?? {}) && '(cliente sin RUC)'}
                    </SelectItem>
                    <SelectItem value="boleta">Boleta de Venta</SelectItem>
                    <SelectItem value="nota_pedido_interna">Documento Interno</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-gray-400 mt-1">
                  Preseleccionado según el comprobante preferido del cliente.
                </p>
              </div>

              <div>
                <Label>Serie</Label>
                <Input
                  value={serie}
                  onChange={(e) => setSerie(e.target.value.toUpperCase())}
                  className="mt-1 font-mono"
                  maxLength={4}
                />
              </div>

              <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                <p className="text-xs text-yellow-700">
                  El comprobante se emitirá y el pedido pasará a estado &quot;Facturado&quot;.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setFacturarDialog(false)}>Cancelar</Button>
                <Button
                  onClick={confirmarFacturacion}
                  disabled={saving}
                  className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirmar y Emitir
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Editar comprobante con trazabilidad */}
      <Dialog open={editarOpen} onOpenChange={(o) => { if (!editSaving) setEditarOpen(o) }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              ✏️ Editar comprobante {editComp?.serie}-{editComp?.numero}
              {editComp?.editado && (
                <span className="text-[10px] bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded font-bold">
                  YA FUE EDITADO
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {editComp && (
            <div className="space-y-4 mt-2">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                <strong>Trazabilidad activa.</strong> Cada modificación queda registrada con tu nombre, fecha y los valores anteriores/nuevos.
                Solo puedes editar mientras el comprobante NO esté enviado a SUNAT.
              </div>

              <div>
                <Label className="text-sm font-semibold">Líneas del comprobante</Label>
                <div className="border border-gray-200 rounded-lg overflow-hidden mt-1">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left py-2 px-3 font-semibold text-gray-600">Descripción</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-600 w-24">Cantidad</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-600 w-28">P. Unit.</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-600 w-28">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editItems.length === 0 ? (
                        <tr><td colSpan={4} className="py-4 text-center text-gray-400 italic">Sin items para editar</td></tr>
                      ) : editItems.map((it, idx) => {
                        const subtotalCalc = (parseFloat(it._cantidad) || 0) * (parseFloat(it._precio) || 0)
                        return (
                          <tr key={it.id} className="border-b border-gray-100 last:border-0">
                            <td className="py-1.5 px-2">
                              <Input
                                value={it.descripcion ?? ''}
                                onChange={(e) => setEditItems((prev) => prev.map((p, i) => i === idx ? { ...p, descripcion: e.target.value } : p))}
                                className="h-8 text-xs"
                                disabled={editSaving}
                              />
                              <div className="text-[10px] text-gray-400 mt-0.5">{(it.productos as any)?.codigo ?? '—'} · {(it.productos as any)?.nombre ?? ''}</div>
                            </td>
                            <td className="py-1.5 px-2">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={it._cantidad}
                                onChange={(e) => setEditItems((prev) => prev.map((p, i) => i === idx ? { ...p, _cantidad: e.target.value } : p))}
                                className="h-8 text-xs text-right font-mono"
                                disabled={editSaving}
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={it._precio}
                                onChange={(e) => setEditItems((prev) => prev.map((p, i) => i === idx ? { ...p, _precio: e.target.value } : p))}
                                className="h-8 text-xs text-right font-mono"
                                disabled={editSaving}
                              />
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono">
                              {formatCurrency(subtotalCalc)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Bloque de totales en vivo */}
                {editComp && editItems.length > 0 && (() => {
                  const tieneIgv = Number(editComp.igv ?? 0) > 0 || Number(editComp.subtotal ?? 0) !== Number(editComp.total ?? 0)
                  const sumaItems = editItems.reduce((acc, it) => {
                    const c = parseFloat(it._cantidad) || 0
                    const p = parseFloat(it._precio) || 0
                    return acc + (c * p)
                  }, 0)
                  // sumaItems está CON IGV (la misma asunción que la BD)
                  const totalCalc = sumaItems
                  const igvCalc = tieneIgv ? totalCalc - (totalCalc / 1.18) : 0
                  const subtotalCalc = totalCalc - igvCalc
                  const totalOriginal = Number(editComp.total ?? 0)
                  const cambioTotal = totalCalc - totalOriginal
                  return (
                    <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Subtotal</span>
                        <span className="font-mono">{formatCurrency(subtotalCalc)}</span>
                      </div>
                      {tieneIgv && (
                        <div className="flex justify-between text-gray-600">
                          <span>IGV (18%)</span>
                          <span className="font-mono">{formatCurrency(igvCalc)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
                        <span className="font-semibold text-gray-900">Total</span>
                        <span className="font-mono font-bold text-lg text-black">
                          {formatCurrency(totalCalc)}
                        </span>
                      </div>
                      {Math.abs(cambioTotal) > 0.01 && (
                        <div className={`flex justify-between text-xs pt-1 border-t border-gray-100 ${cambioTotal > 0 ? 'text-green-700' : 'text-red-700'}`}>
                          <span>Cambio vs original ({formatCurrency(totalOriginal)})</span>
                          <span className="font-mono font-semibold">
                            {cambioTotal > 0 ? '+' : ''}{formatCurrency(cambioTotal)}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })()}

                <p className="text-[10px] text-gray-500 mt-2">
                  Vista previa en vivo. Los totales se persisten al pulsar &ldquo;Guardar con trazabilidad&rdquo;.
                </p>
              </div>

              <div>
                <Label className="text-sm font-semibold">
                  Nota / motivo del cambio
                  <span className="text-gray-400 font-normal text-xs"> (opcional pero recomendado)</span>
                </Label>
                <Input
                  placeholder='Ej: "Corregir cantidad por error de digitado, cliente reportó al recibir"'
                  value={editNota}
                  onChange={(e) => setEditNota(e.target.value)}
                  className="mt-1"
                  disabled={editSaving}
                  maxLength={200}
                />
              </div>

              {/* Historial de cambios previos */}
              {editHistorial.length > 0 && (
                <div>
                  <Label className="text-sm font-semibold">Historial de modificaciones ({editHistorial.length})</Label>
                  <div className="mt-1 border border-gray-200 rounded-lg max-h-44 overflow-y-auto bg-gray-50/50">
                    {editHistorial.map((h: any) => (
                      <div key={h.id} className="px-3 py-2 border-b border-gray-100 last:border-0 text-xs">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-semibold text-gray-800">{h.usuario_nombre}</span>
                          <span className="text-[10px] text-gray-400">{new Date(h.created_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}</span>
                        </div>
                        <div className="text-gray-700 mt-0.5">
                          <span className="font-mono text-[10px] bg-gray-200 px-1 rounded">{h.campo}</span>
                          {h.item_descripcion && <span className="text-gray-500"> · {h.item_descripcion}</span>}
                          <span>: </span>
                          <span className="line-through text-red-500">{h.valor_anterior ?? '—'}</span>
                          <span className="mx-1">→</span>
                          <span className="text-green-700 font-semibold">{h.valor_nuevo ?? '—'}</span>
                        </div>
                        {h.nota && <div className="text-[10px] text-gray-500 italic mt-0.5">&ldquo;{h.nota}&rdquo;</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button variant="outline" onClick={() => setEditarOpen(false)} disabled={editSaving}>
                  Cancelar
                </Button>
                <Button
                  onClick={guardarEdicion}
                  disabled={editSaving || editItems.length === 0}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-2"
                >
                  {editSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Guardar con trazabilidad
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
