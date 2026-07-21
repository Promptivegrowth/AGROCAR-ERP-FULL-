'use client'

import { useEffect, useState, useCallback } from 'react'
import { FileText, Loader2, CheckCircle, AlertCircle, DollarSign, Receipt, Eye, ExternalLink, Search } from 'lucide-react'
import Link from 'next/link'
import VentaDirectaDialog from './venta-directa-dialog'
import NotaCreditoDialog from './nota-credito-dialog'
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
  // Búsqueda libre: número/serie de comprobante, número de pedido, RUC/DNI,
  // nombre del cliente o nombre del vendedor — para ubicar facturas rápido.
  const [filtroBusqueda, setFiltroBusqueda] = useState<string>('')
  // Edición controlada
  const [editarOpen, setEditarOpen] = useState(false)
  const [editComp, setEditComp] = useState<any>(null)
  const [editItems, setEditItems] = useState<any[]>([])
  // Edición de cliente (razón social) en comprobantes — para reventa
  const [editClienteOpen, setEditClienteOpen] = useState(false)
  const [editClienteNombre, setEditClienteNombre] = useState('')
  const [editClienteDoc, setEditClienteDoc] = useState('')
  const [editClienteMotivo, setEditClienteMotivo] = useState('')
  // ID del cliente registrado seleccionado (null = cliente externo / texto libre)
  const [editClienteId, setEditClienteId] = useState<string | null>(null)
  // Lista de clientes registrados (lazy load al abrir el dialog)
  const [clientesLista, setClientesLista] = useState<Array<{ id: string; razon_social: string; ruc: string | null; dni: string | null }>>([])
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)
  // Anulación
  const [anularOpen, setAnularOpen] = useState(false)
  const [anularComp, setAnularComp] = useState<any>(null)
  const [anularMotivo, setAnularMotivo] = useState('')
  const [anularSaving, setAnularSaving] = useState(false)
  // Guía de remisión
  const [guiaOpen, setGuiaOpen] = useState(false)
  const [guiaComp, setGuiaComp] = useState<any>(null)
  const [ncOpen, setNcOpen] = useState(false)
  const [ncCompId, setNcCompId] = useState<string | null>(null)
  const [guiaSaving, setGuiaSaving] = useState(false)
  const [guiaForm, setGuiaForm] = useState({
    fecha_inicio_traslado: '',
    motivo_traslado: 'venta',
    motivo_descripcion: '',
    punto_partida: '',
    punto_llegada: '',
    peso_bruto: '',
    vehiculo_placa: '',
    conductor_nombre: '',
    conductor_doc: '',
    conductor_licencia: '',
    modalidad: 'privado',
    transportista_razon_social: '',
    transportista_ruc: '',
  })
  // Catálogos para la guía: flota y conductores del sistema + ítems a trasladar
  const [guiaVehiculos, setGuiaVehiculos] = useState<any[]>([])
  const [guiaConductores, setGuiaConductores] = useState<any[]>([])
  const [guiaItems, setGuiaItems] = useState<any[]>([])
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
          cliente_externo_nombre, cliente_externo_doc,
          clientes(razon_social, ruc, dni),
          pedidos(numero, profiles!pedidos_vendedor_id_fkey(full_name))
        `)
        .order('fecha_emision', { ascending: false })
        .limit(1000),
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
    // Búsqueda libre: número, serie-número, cliente (razón social, RUC, DNI),
    // vendedor (full_name) o número de pedido.
    const q = filtroBusqueda.trim().toLowerCase()
    if (q.length > 0) {
      const numeroPad = `${c.serie}-${String(c.numero).padStart(8, '0')}`.toLowerCase()
      const numeroSimple = String(c.numero ?? '').toLowerCase()
      const cliNombre = (c.clientes?.razon_social ?? c.cliente_externo_nombre ?? '').toLowerCase()
      const cliDoc = (c.clientes?.ruc ?? c.clientes?.dni ?? c.cliente_externo_doc ?? '').toLowerCase()
      const vend = (c.pedidos?.profiles?.full_name ?? '').toLowerCase()
      const pedNum = (c.pedidos?.numero ?? '').toLowerCase()
      const hit =
        numeroPad.includes(q) ||
        numeroSimple.includes(q) ||
        cliNombre.includes(q) ||
        cliDoc.includes(q) ||
        vend.includes(q) ||
        pedNum.includes(q)
      if (!hit) return false
    }
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

  // ── Eliminar una línea del comprobante (no editar a 0, borrar de verdad)
  async function eliminarLineaComprobante(item: any) {
    if (!editComp) return
    if (editItems.length <= 1) {
      toast.error('No puedes eliminar la última línea', {
        description: 'Si quieres dejar el comprobante vacío, anúlalo completo.',
      })
      return
    }
    const desc = item.descripcion ?? item.productos?.nombre ?? 'esta línea'
    if (!confirm(`¿Eliminar "${desc}" del comprobante?\n\nEsta acción queda registrada en el historial.`)) return
    setEditSaving(true)
    const motivo = editNota.trim() || 'Producto retirado del comprobante'
    const { error } = await (supabase.rpc as any)('eliminar_item_comprobante', {
      p_item_id: item.id,
      p_motivo: motivo,
    })
    setEditSaving(false)
    if (error) {
      toast.error('No se pudo eliminar la línea', { description: error.message })
      return
    }
    toast.success('Línea eliminada', { description: 'Totales recalculados' })
    // Refrescar items y comprobante
    const { data: items } = await (supabase as any)
      .from('comprobantes_items')
      .select('*, productos(codigo, nombre)')
      .eq('comprobante_id', editComp.id)
    setEditItems((items ?? []).map((it: any) => ({ ...it, _cantidad: String(it.cantidad), _precio: String(it.precio_unitario) })))
    const { data: compRefresh } = await (supabase as any)
      .from('comprobantes')
      .select('subtotal, igv, total, editado, editado_at')
      .eq('id', editComp.id)
      .single()
    if (compRefresh) setEditComp({ ...editComp, ...compRefresh })
    // Refrescar historial
    const { data: hist } = await (supabase as any)
      .from('comprobantes_ediciones')
      .select('*')
      .eq('comprobante_id', editComp.id)
      .order('created_at', { ascending: false })
    setEditHistorial(hist ?? [])
    loadData()
  }

  // ── Guía de Remisión Electrónica
  async function abrirGuia(comp: any) {
    setGuiaComp(comp)
    const manana = new Date(); manana.setDate(manana.getDate() + 1)

    // Cargar en paralelo: dirección real del cliente, ítems con peso,
    // flota de vehículos y conductores registrados en el sistema.
    const [cliRes, itemsRes, vehRes, condRes] = await Promise.all([
      comp.cliente_id
        ? (supabase as any).from('clientes').select('razon_social, direccion, ruc, dni').eq('id', comp.cliente_id).maybeSingle()
        : Promise.resolve({ data: null }),
      (supabase as any).from('comprobantes_items')
        .select('descripcion, cantidad, productos(peso_kg, nombre)')
        .eq('comprobante_id', comp.id),
      (supabase as any).from('vehiculos').select('id, placa, descripcion, capacidad_kg').eq('activo', true).order('placa'),
      (supabase as any).from('conductores').select('id, nombre_completo, dni, licencia_numero').eq('activo', true).order('nombre_completo'),
    ])

    const cli = cliRes.data as any
    const items = ((itemsRes.data ?? []) as any[]).map((it) => ({
      descripcion: it.descripcion ?? it.productos?.nombre ?? '—',
      cantidad: Number(it.cantidad ?? 0),
      peso_unit: Number(it.productos?.peso_kg ?? 0),
      peso_total: Number(it.cantidad ?? 0) * Number(it.productos?.peso_kg ?? 0),
    }))
    const pesoTotal = items.reduce((a, it) => a + it.peso_total, 0)
    setGuiaItems(items)
    setGuiaVehiculos((vehRes.data ?? []) as any[])
    setGuiaConductores((condRes.data ?? []) as any[])

    // Punto de llegada: razón social + dirección REAL del cliente
    const nombreCliente = cli?.razon_social ?? comp.clientes?.razon_social ?? comp.cliente_externo_nombre ?? ''
    const dirCliente = cli?.direccion ?? ''
    const llegada = [nombreCliente, dirCliente].filter(Boolean).join(' · ')

    setGuiaForm({
      fecha_inicio_traslado: manana.toISOString().slice(0, 10),
      motivo_traslado: 'venta',
      motivo_descripcion: '',
      punto_partida: 'CALLE EMILIO FORERO 553-A PARA GRANDE TACNA FUNDO PARA GRANDE PARCELA 31 SUB.LT.1 TACNA - TACNA - TACNA',
      punto_llegada: llegada,
      peso_bruto: pesoTotal > 0 ? pesoTotal.toFixed(2) : '',
      vehiculo_placa: '',
      conductor_nombre: '',
      conductor_doc: '',
      conductor_licencia: '',
      modalidad: 'privado',
      transportista_razon_social: '',
      transportista_ruc: '',
    })
    setGuiaOpen(true)
  }

  async function emitirGuia() {
    if (!guiaComp) return
    if (!guiaForm.vehiculo_placa.trim() || !guiaForm.conductor_nombre.trim() || !guiaForm.conductor_doc.trim()) {
      toast.error('Faltan datos', { description: 'Placa, nombre y documento del conductor son obligatorios.' })
      return
    }
    setGuiaSaving(true)
    const { data, error } = await (supabase.rpc as any)('emitir_guia_desde_comprobante', {
      p_comprobante_id: guiaComp.id,
      p_fecha_inicio_traslado: guiaForm.fecha_inicio_traslado,
      p_motivo_traslado: guiaForm.motivo_traslado,
      p_punto_partida: guiaForm.punto_partida || null,
      p_punto_llegada: guiaForm.punto_llegada || null,
      p_peso_bruto: parseFloat(guiaForm.peso_bruto) || 0,
      p_vehiculo_placa: guiaForm.vehiculo_placa,
      p_conductor_nombre: guiaForm.conductor_nombre,
      p_conductor_doc: guiaForm.conductor_doc,
      p_conductor_licencia: guiaForm.conductor_licencia || null,
      p_modalidad: guiaForm.modalidad,
      p_transportista_razon_social: guiaForm.modalidad === 'publico' ? guiaForm.transportista_razon_social : null,
      p_transportista_ruc: guiaForm.modalidad === 'publico' ? guiaForm.transportista_ruc : null,
      p_motivo_descripcion: guiaForm.motivo_descripcion || null,
    })
    setGuiaSaving(false)
    if (error || !data?.id) {
      toast.error('No se pudo emitir', { description: error?.message ?? 'Error desconocido' })
      return
    }
    toast.success(`Guía ${data.numero_completo} emitida`, {
      description: 'Se abrirá en una nueva pestaña.',
    })
    setGuiaOpen(false)
    setGuiaComp(null)
    window.open(`/guia/${data.id}`, '_blank', 'noopener,noreferrer')
  }

  // ── Anulación de comprobante (mantiene correlativo, libera pedido para re-facturar)
  function abrirAnular(comp: any) {
    setAnularComp(comp)
    setAnularMotivo('')
    setAnularOpen(true)
  }

  async function confirmarAnulacion() {
    if (!anularComp) return
    if (anularMotivo.trim().length < 5) {
      toast.error('Motivo muy corto', { description: 'Ingresa al menos 5 caracteres explicando el motivo de la anulación.' })
      return
    }
    setAnularSaving(true)
    const { error } = await (supabase.rpc as any)('anular_comprobante', {
      p_comprobante_id: anularComp.id,
      p_motivo: anularMotivo.trim(),
    })
    setAnularSaving(false)
    if (error) {
      toast.error('No se pudo anular', { description: error.message })
      return
    }
    toast.success(`Comprobante ${anularComp.serie}-${String(anularComp.numero).padStart(8, '0')} anulado`, {
      description: 'El correlativo se conserva. El pedido vuelve a "enviado" para re-facturar si quieres.',
    })
    setAnularOpen(false)
    setAnularComp(null)
    setAnularMotivo('')
    loadData()
  }

  // ── Cambio de cliente (reventa a otro cliente)
  async function abrirEditarCliente() {
    if (!editComp) return
    setEditClienteNombre(editComp.clientes?.razon_social ?? editComp.cliente_externo_nombre ?? '')
    setEditClienteDoc(editComp.clientes?.ruc ?? editComp.clientes?.dni ?? editComp.cliente_externo_doc ?? '')
    setEditClienteMotivo('')
    setEditClienteId(editComp.cliente_id ?? null)
    setShowClienteDropdown(false)
    setEditClienteOpen(true)
    // Cargar lista de clientes activos para autocomplete (solo una vez)
    if (clientesLista.length === 0) {
      const { data } = await supabase
        .from('clientes')
        .select('id, razon_social, ruc, dni')
        .eq('estado', 'activo')
        .order('razon_social')
      setClientesLista((data as any) ?? [])
    }
  }

  // Filtro del dropdown según búsqueda en el input nombre
  const clientesFiltrados = (() => {
    const q = editClienteNombre.trim().toLowerCase()
    if (q.length < 2) return []
    return clientesLista
      .filter((c) =>
        c.razon_social.toLowerCase().includes(q) ||
        (c.ruc ?? '').includes(q) ||
        (c.dni ?? '').includes(q),
      )
      .slice(0, 8)
  })()

  function seleccionarClienteDropdown(c: { id: string; razon_social: string; ruc: string | null; dni: string | null }) {
    setEditClienteId(c.id)
    setEditClienteNombre(c.razon_social)
    setEditClienteDoc(c.ruc ?? c.dni ?? '')
    setShowClienteDropdown(false)
  }

  async function confirmarEditarCliente() {
    if (!editComp) return
    if (editClienteNombre.trim().length < 3) {
      toast.error('Nombre/razón social muy corta')
      return
    }
    setEditSaving(true)
    // Si el usuario seleccionó del dropdown, pasamos cliente_id; sino, lo
    // guardamos como cliente externo (texto libre) para casos no registrados.
    const { error } = await (supabase.rpc as any)('editar_cliente_comprobante', {
      p_comprobante_id: editComp.id,
      p_cliente_id: editClienteId,
      p_cliente_externo_nombre: editClienteId ? null : editClienteNombre.trim(),
      p_cliente_externo_doc: editClienteId ? null : (editClienteDoc.trim() || null),
      p_motivo: editClienteMotivo.trim() || 'Reventa / cambio de cliente',
    })
    setEditSaving(false)
    if (error) {
      toast.error('No se pudo cambiar el cliente', { description: error.message })
      return
    }
    toast.success('Cliente del comprobante actualizado')
    setEditClienteOpen(false)
    // Recargar el comprobante para reflejar el cliente nuevo
    const { data: refresh } = await (supabase as any)
      .from('comprobantes')
      .select(`*, clientes(razon_social, ruc, dni), pedidos(vendedor_id)`)
      .eq('id', editComp.id)
      .single()
    if (refresh) abrirEditar(refresh)
    loadData()
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
        // Si solo hubo eliminaciones (que se aplican al instante via la RPC
        // eliminar_item_comprobante), el comprobante YA está actualizado.
        // editComp.editado se setea al eliminar — usamos eso como pista.
        if (editComp?.editado) {
          toast.success('Comprobante actualizado', {
            description: 'Los cambios (eliminaciones de líneas) ya se aplicaron y los totales se recalcularon.',
          })
          setEditarOpen(false)
          loadData()
        } else {
          toast.info('Sin cambios', { description: 'No modificaste ningún campo.' })
        }
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
      // SUNAT acepta como fecha de emisión la fecha real de entrega de bienes.
      // Daniel pidió que si el despacho es el día siguiente, la factura salga
      // con esa fecha (no la de creación del comprobante).
      p_fecha_emision: pedido.fecha_despacho || hoyLima(),
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
      // SUNAT acepta como fecha de emisión la fecha real de entrega de bienes.
      // Daniel pidió que si el despacho es el día siguiente, la factura salga
      // con esa fecha (no la de creación del comprobante).
      p_fecha_emision: pedidoSeleccionado.fecha_despacho || hoyLima(),
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

      <NotaCreditoDialog
        open={ncOpen}
        onOpenChange={setNcOpen}
        comprobanteId={ncCompId}
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
              <div className="px-4 pb-3 border-b border-gray-100 space-y-2">
                {/* Búsqueda libre prominente */}
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <Input
                    type="text"
                    value={filtroBusqueda}
                    onChange={(e) => setFiltroBusqueda(e.target.value)}
                    placeholder="Buscar por número (F001-0000123, 98709, etc.), cliente (razón social/RUC/DNI), vendedor o N° de pedido"
                    className="h-9 text-sm pl-9 pr-10 w-full"
                  />
                  {filtroBusqueda && (
                    <button
                      onClick={() => setFiltroBusqueda('')}
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs"
                      title="Limpiar búsqueda"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-2">
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
                  {(filtroDesde || filtroHasta || filtroTipo !== 'todos' || filtroBusqueda) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setFiltroDesde(''); setFiltroHasta(''); setFiltroTipo('todos'); setFiltroBusqueda('') }}
                      className="text-xs h-8 text-gray-600"
                    >
                      Limpiar filtros
                    </Button>
                  )}
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
                        {['Serie-Número', 'Tipo', 'Cliente', 'Vendedor', 'Fecha', 'Total', 'Estado', 'Acciones'].map((h) => (
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
                            <td className="py-3 px-4 text-gray-800">
                              <div className="truncate max-w-[220px]">
                                {(c.clientes as any)?.razon_social ?? (c as any).cliente_externo_nombre ?? '—'}
                              </div>
                              <div className="text-[10px] text-gray-400 font-mono">
                                {(c.clientes as any)?.ruc ?? (c.clientes as any)?.dni ?? (c as any).cliente_externo_doc ?? ''}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-xs text-gray-700 truncate max-w-[140px]">
                              {(c as any).pedidos?.profiles?.full_name ?? '—'}
                            </td>
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
                                {puedeEditar && !c.enviado_sunat && c.estado !== 'anulado' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => abrirEditar(c)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-700 hover:text-amber-900 hover:bg-amber-50 rounded transition-colors"
                                      title="Editar comprobante (con auditoría)"
                                    >
                                      ✏️ Editar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => abrirAnular(c)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 hover:text-red-900 hover:bg-red-50 rounded transition-colors"
                                      title="Anular comprobante (mantiene correlativo)"
                                    >
                                      🚫 Anular
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => abrirGuia(c)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 hover:text-purple-900 hover:bg-purple-50 rounded transition-colors"
                                      title="Emitir guía de remisión electrónica para este comprobante"
                                    >
                                      📄 Guía
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setNcCompId(c.id); setNcOpen(true) }}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-orange-700 hover:text-orange-900 hover:bg-orange-50 rounded transition-colors"
                                      title="Emitir Nota de Crédito para este comprobante"
                                    >
                                      ⬅️ NC
                                    </button>
                                  </>
                                )}
                                {c.estado === 'anulado' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded">
                                    ANULADO
                                  </span>
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

              {/* Cliente actual + botón cambiar cliente (caso reventa) */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-blue-700 uppercase">Cliente del comprobante</p>
                  <p className="text-sm font-bold text-blue-900 truncate">
                    {editComp.clientes?.razon_social ?? editComp.cliente_externo_nombre ?? 'Sin cliente'}
                  </p>
                  <p className="text-[10px] text-blue-700">
                    {editComp.clientes?.ruc ?? editComp.clientes?.dni ?? editComp.cliente_externo_doc ?? '—'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={abrirEditarCliente}
                  className="px-3 py-1.5 text-xs font-bold rounded-md border border-blue-400 text-blue-700 hover:bg-blue-100 shrink-0"
                  title="Cambiar la razón social (útil cuando el cliente original devuelve y se revende a otro)"
                >
                  Cambiar cliente
                </button>
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
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editItems.length === 0 ? (
                        <tr><td colSpan={5} className="py-4 text-center text-gray-400 italic">Sin items para editar</td></tr>
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
                            <td className="py-1.5 px-1 text-center">
                              <button
                                type="button"
                                onClick={() => eliminarLineaComprobante(it)}
                                disabled={editSaving || editItems.length <= 1}
                                title={editItems.length <= 1
                                  ? 'No se puede eliminar la única línea — mejor anula el comprobante'
                                  : 'Eliminar esta línea del comprobante'}
                                className="text-red-600 hover:bg-red-50 disabled:text-gray-300 disabled:hover:bg-transparent rounded p-1 transition-colors"
                              >
                                <span className="text-base leading-none">🗑️</span>
                              </button>
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

      {/* Dialog: Cambiar cliente del comprobante (reventa) */}
      <Dialog open={editClienteOpen} onOpenChange={(o) => { if (!editSaving) setEditClienteOpen(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cambiar cliente del comprobante</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
              Útil cuando el cliente original devuelve la mercadería y se la revendes a otro.
              <strong> Solo disponible si el comprobante NO se ha enviado a SUNAT.</strong> Queda
              registrado en el historial.
            </div>
            <div className="relative">
              <Label className="text-sm font-semibold">
                Nueva razón social / Nombre *
                {editClienteId && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-bold">
                    ✓ Cliente registrado
                  </span>
                )}
              </Label>
              <Input
                value={editClienteNombre}
                onChange={(e) => {
                  setEditClienteNombre(e.target.value)
                  setEditClienteId(null) // si edita el texto, deja de ser "registrado"
                  setShowClienteDropdown(true)
                }}
                onFocus={() => setShowClienteDropdown(true)}
                onBlur={() => setTimeout(() => setShowClienteDropdown(false), 200)}
                placeholder="Escribe para buscar entre clientes guardados"
                className="mt-1"
                autoComplete="off"
              />
              {/* Dropdown de clientes filtrados */}
              {showClienteDropdown && clientesFiltrados.length > 0 && (
                <div className="absolute z-50 mt-1 left-0 right-0 bg-white border border-gray-300 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {clientesFiltrados.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); seleccionarClienteDropdown(c) }}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0"
                    >
                      <p className="text-sm font-semibold text-gray-900 truncate">{c.razon_social}</p>
                      <p className="text-[10px] text-gray-500 font-mono">
                        {c.ruc ? `RUC ${c.ruc}` : c.dni ? `DNI ${c.dni}` : 'Sin documento'}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {showClienteDropdown && editClienteNombre.trim().length >= 2 && clientesFiltrados.length === 0 && (
                <div className="absolute z-50 mt-1 left-0 right-0 bg-amber-50 border border-amber-200 rounded-lg p-2 text-[11px] text-amber-800">
                  No coincide con clientes registrados. Se guardará como cliente externo (texto libre).
                </div>
              )}
            </div>
            <div>
              <Label className="text-sm font-semibold">
                RUC o DNI
                {editClienteId && <span className="text-[10px] text-gray-400 font-normal ml-1">(auto del cliente)</span>}
              </Label>
              <Input
                value={editClienteDoc}
                onChange={(e) => setEditClienteDoc(e.target.value)}
                placeholder="11 dígitos para RUC, 8 para DNI"
                className="mt-1"
                maxLength={11}
                disabled={!!editClienteId}
              />
            </div>
            <div>
              <Label className="text-sm font-semibold">
                Motivo <span className="text-gray-400 font-normal text-xs">(opcional, recomendado)</span>
              </Label>
              <Input
                value={editClienteMotivo}
                onChange={(e) => setEditClienteMotivo(e.target.value)}
                placeholder='Ej: "Cliente original rechazó mercadería, se vendió a tercero"'
                className="mt-1"
                maxLength={200}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setEditClienteOpen(false)} disabled={editSaving}>
                Cancelar
              </Button>
              <Button
                onClick={confirmarEditarCliente}
                disabled={editSaving || editClienteNombre.trim().length < 3}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {editSaving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Cambiar cliente
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: Emitir Guía de Remisión */}
      <Dialog open={guiaOpen} onOpenChange={(o) => { if (!guiaSaving) setGuiaOpen(o) }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-purple-700">📄 Emitir Guía de Remisión Electrónica</DialogTitle>
          </DialogHeader>
          {guiaComp && (
            <div className="space-y-3 mt-2">
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-900">
                Guía para comprobante <strong className="font-mono">{guiaComp.serie}-{String(guiaComp.numero).padStart(8, '0')}</strong> ·
                Destinatario: <strong>{guiaComp.clientes?.razon_social ?? guiaComp.cliente_externo_nombre ?? '—'}</strong>
                {(guiaComp.clientes?.ruc || guiaComp.clientes?.dni) && (
                  <span className="font-mono"> · {guiaComp.clientes?.ruc ? `RUC ${guiaComp.clientes.ruc}` : `DNI ${guiaComp.clientes.dni}`}</span>
                )}
              </div>

              {/* Productos que se trasladan (heredados del comprobante) */}
              {guiaItems.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <p className="text-[10px] font-bold text-gray-600 uppercase bg-gray-50 px-2 py-1.5 border-b border-gray-200">
                    📦 Productos que se trasladan ({guiaItems.length})
                  </p>
                  <table className="w-full text-[11px]">
                    <thead className="bg-gray-50/50 text-gray-500">
                      <tr>
                        <th className="text-left px-2 py-1">Descripción</th>
                        <th className="text-right px-2 py-1 w-16">Cant.</th>
                        <th className="text-right px-2 py-1 w-20">Peso (KG)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {guiaItems.map((it, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-2 py-1 truncate max-w-[280px]">{it.descripcion}</td>
                          <td className="px-2 py-1 text-right font-mono">{it.cantidad}</td>
                          <td className="px-2 py-1 text-right font-mono">
                            {it.peso_total > 0 ? it.peso_total.toFixed(2) : <span className="text-amber-600" title="Producto sin peso configurado">s/p</span>}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                        <td className="px-2 py-1" colSpan={2}>PESO BRUTO TOTAL</td>
                        <td className="px-2 py-1 text-right font-mono">
                          {guiaItems.reduce((a, it) => a + it.peso_total, 0).toFixed(2)} KG
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {guiaItems.some((it) => it.peso_unit === 0) && (
                    <p className="text-[10px] text-amber-700 bg-amber-50 px-2 py-1">
                      ⚠ Algunos productos no tienen peso configurado (s/p) — complétalo en Maestros → Productos o ajusta el peso total manualmente.
                    </p>
                  )}
                </div>
              )}

              {/* Fechas + Motivo */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-semibold">Fecha inicio traslado *</Label>
                  <Input type="date"
                    value={guiaForm.fecha_inicio_traslado}
                    onChange={(e) => setGuiaForm((p) => ({ ...p, fecha_inicio_traslado: e.target.value }))}
                    className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Motivo del traslado *</Label>
                  <select
                    value={guiaForm.motivo_traslado}
                    onChange={(e) => setGuiaForm((p) => ({ ...p, motivo_traslado: e.target.value }))}
                    className="mt-1 w-full h-9 px-2 text-sm border border-gray-300 rounded-md bg-white"
                  >
                    <option value="venta">Venta</option>
                    <option value="compra">Compra</option>
                    <option value="traslado_entre_establecimientos">Traslado entre establecimientos</option>
                    <option value="devolucion">Devolución</option>
                    <option value="recojo_bienes">Recojo de bienes</option>
                    <option value="otros">Otros</option>
                  </select>
                </div>
              </div>

              {/* Direcciones */}
              <div>
                <Label className="text-xs font-semibold">Punto de partida *</Label>
                <Input value={guiaForm.punto_partida}
                  onChange={(e) => setGuiaForm((p) => ({ ...p, punto_partida: e.target.value }))}
                  className="mt-1 text-xs" />
                <p className="text-[10px] text-gray-500 mt-0.5">Por defecto: domicilio fiscal + establecimiento anexo AGROCAR</p>
              </div>
              <div>
                <Label className="text-xs font-semibold">Punto de llegada *</Label>
                <Input value={guiaForm.punto_llegada}
                  onChange={(e) => setGuiaForm((p) => ({ ...p, punto_llegada: e.target.value }))}
                  className="mt-1 text-xs"
                  placeholder="Dirección de entrega" />
              </div>

              {/* Modalidad + Peso */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-semibold">Modalidad *</Label>
                  <select
                    value={guiaForm.modalidad}
                    onChange={(e) => setGuiaForm((p) => ({ ...p, modalidad: e.target.value }))}
                    className="mt-1 w-full h-9 px-2 text-sm border border-gray-300 rounded-md bg-white"
                  >
                    <option value="privado">Privado (vehículo propio)</option>
                    <option value="publico">Público (transportista tercero)</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs font-semibold">Peso bruto total (KG)</Label>
                  <Input type="number" step="0.01"
                    value={guiaForm.peso_bruto}
                    onChange={(e) => setGuiaForm((p) => ({ ...p, peso_bruto: e.target.value }))}
                    className="mt-1" />
                </div>
              </div>

              {guiaForm.modalidad === 'publico' && (
                <div className="grid grid-cols-2 gap-3 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  <div>
                    <Label className="text-xs font-semibold">Transportista (razón social) *</Label>
                    <Input value={guiaForm.transportista_razon_social}
                      onChange={(e) => setGuiaForm((p) => ({ ...p, transportista_razon_social: e.target.value }))}
                      className="mt-1 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold">RUC transportista *</Label>
                    <Input value={guiaForm.transportista_ruc}
                      onChange={(e) => setGuiaForm((p) => ({ ...p, transportista_ruc: e.target.value }))}
                      className="mt-1 text-xs" maxLength={11} />
                  </div>
                </div>
              )}

              {/* Vehículo — selector de la flota del sistema */}
              <div className="border-t border-gray-200 pt-3">
                <p className="text-xs font-bold text-gray-700 uppercase mb-2">Datos del vehículo</p>
                <Label className="text-xs font-semibold">Elegir de mi flota</Label>
                <select
                  value=""
                  onChange={(e) => {
                    const v = guiaVehiculos.find((x) => x.id === e.target.value)
                    if (v) setGuiaForm((p) => ({ ...p, vehiculo_placa: v.placa }))
                  }}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-300 rounded-md bg-white"
                >
                  <option value="">— Seleccionar vehículo ({guiaVehiculos.length} registrados) —</option>
                  {guiaVehiculos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.placa} · {v.descripcion ?? ''} {v.capacidad_kg ? `(${v.capacidad_kg} kg)` : ''}
                    </option>
                  ))}
                </select>
                <Label className="text-xs font-semibold mt-2 block">Placa principal *</Label>
                <Input value={guiaForm.vehiculo_placa}
                  onChange={(e) => setGuiaForm((p) => ({ ...p, vehiculo_placa: e.target.value.toUpperCase() }))}
                  className="mt-1 font-mono uppercase"
                  placeholder="Z8J708" maxLength={10} />
                <p className="text-[10px] text-gray-500 mt-0.5">Al elegir de la flota se llena solo. También puedes escribir una placa manualmente.</p>
              </div>

              {/* Conductor — selector de conductores registrados */}
              <div className="border-t border-gray-200 pt-3">
                <p className="text-xs font-bold text-gray-700 uppercase mb-2">Datos del conductor</p>
                <Label className="text-xs font-semibold">Elegir conductor registrado</Label>
                <select
                  value=""
                  onChange={(e) => {
                    const c = guiaConductores.find((x) => x.id === e.target.value)
                    if (c) setGuiaForm((p) => ({
                      ...p,
                      conductor_nombre: (c.nombre_completo ?? '').toUpperCase(),
                      conductor_doc: c.dni ?? '',
                      conductor_licencia: (c.licencia_numero ?? '').toUpperCase(),
                    }))
                  }}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-300 rounded-md bg-white"
                >
                  <option value="">— Seleccionar conductor ({guiaConductores.length} registrados) —</option>
                  {guiaConductores.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre_completo} · DNI {c.dni} {c.licencia_numero ? `· Lic. ${c.licencia_numero}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-500 mt-0.5 mb-2">Al elegirlo se llenan nombre, DNI y licencia. Se administran en Maestros → Conductores.</p>
                <div>
                  <Label className="text-xs font-semibold">Nombre completo *</Label>
                  <Input value={guiaForm.conductor_nombre}
                    onChange={(e) => setGuiaForm((p) => ({ ...p, conductor_nombre: e.target.value.toUpperCase() }))}
                    className="mt-1 uppercase"
                    placeholder="VALERIO AGUILAR JARRO" />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <Label className="text-xs font-semibold">DNI *</Label>
                    <Input value={guiaForm.conductor_doc}
                      onChange={(e) => setGuiaForm((p) => ({ ...p, conductor_doc: e.target.value.replace(/\D/g, '') }))}
                      className="mt-1 font-mono"
                      placeholder="40389487" maxLength={8} />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold">N° licencia conducir</Label>
                    <Input value={guiaForm.conductor_licencia}
                      onChange={(e) => setGuiaForm((p) => ({ ...p, conductor_licencia: e.target.value.toUpperCase() }))}
                      className="mt-1 font-mono uppercase"
                      placeholder="K40389487" />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button variant="outline" onClick={() => setGuiaOpen(false)} disabled={guiaSaving}>
                  Cancelar
                </Button>
                <Button onClick={emitirGuia} disabled={guiaSaving}
                  className="bg-purple-600 hover:bg-purple-700 text-white">
                  {guiaSaving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  📄 Emitir guía
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Anular comprobante */}
      <Dialog open={anularOpen} onOpenChange={(o) => { if (!anularSaving) setAnularOpen(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-700">🚫 Anular comprobante</DialogTitle>
          </DialogHeader>
          {anularComp && (
            <div className="space-y-3 mt-2">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-900">
                Vas a anular <strong className="font-mono">{anularComp.serie}-{String(anularComp.numero).padStart(8, '0')}</strong>.
                <ul className="list-disc list-inside mt-1.5 space-y-0.5">
                  <li>El correlativo se conserva (SUNAT lo exige).</li>
                  <li>El comprobante queda marcado como <strong>ANULADO</strong>.</li>
                  <li>El pedido asociado vuelve a estado <strong>&ldquo;enviado&rdquo;</strong> para que puedas re-facturarlo.</li>
                  <li>Esta acción queda registrada con tu nombre y fecha.</li>
                </ul>
              </div>
              <div>
                <Label className="text-sm font-semibold">
                  Motivo de anulación * <span className="text-gray-400 font-normal text-xs">(mín. 5 caracteres)</span>
                </Label>
                <Input
                  value={anularMotivo}
                  onChange={(e) => setAnularMotivo(e.target.value)}
                  placeholder='Ej: "Error de cantidad en línea 2", "Cliente devolvió mercadería"'
                  className="mt-1"
                  maxLength={300}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button variant="outline" onClick={() => setAnularOpen(false)} disabled={anularSaving}>
                  Cancelar
                </Button>
                <Button
                  onClick={confirmarAnulacion}
                  disabled={anularSaving || anularMotivo.trim().length < 5}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  {anularSaving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  Anular comprobante
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
