'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Loader2, ShoppingCart, ChevronLeft, ChevronRight, X, Package2, Eye, Calendar, FileText, Building2, Receipt, Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

const itemSchema = z.object({
  producto_id: z.string().min(1, 'Seleccione producto'),
  cantidad: z.coerce.number().positive('Debe ser mayor a 0'),
  precio_unitario: z.coerce.number().positive('Debe ser mayor a 0'),
  total_linea: z.coerce.number().min(0).optional(),
  lote_numero: z.string().optional(),
  lote_fecha_fabricacion: z.string().optional(),
  lote_fecha_vencimiento: z.string().optional(),
})

const compraSchema = z.object({
  proveedor_id: z.string().min(1, 'Seleccione proveedor'),
  tipo: z.enum(['directa', 'con_oc']),
  numero_factura: z.string().min(1, 'Requerido'),
  fecha: z.string().min(1, 'Requerido'),
  metodo_valorizacion: z.enum(['promedio', 'fifo', 'directo']),
  items: z.array(itemSchema).min(1, 'Agregue al menos un producto'),
})

type CompraFormData = z.infer<typeof compraSchema>

const IGV_RATE = 0.18
const PAGE_SIZE = 15

const ESTADO_CONFIG: Record<string, { label: string; className: string; desc: string }> = {
  registrada: { label: 'Registrada',    className: 'bg-gray-100 text-gray-700',     desc: 'Factura ingresada, aún no impacta almacén' },
  recibida:   { label: 'Recibida',      className: 'bg-blue-100 text-blue-700',     desc: 'Mercadería validada, lista para aplicar' },
  aplicada:   { label: 'Aplicada',      className: 'bg-green-100 text-green-700',   desc: 'Impactó stock y costos' },
  anulado:    { label: 'Anulada',       className: 'bg-red-100 text-red-700',       desc: 'Compra cancelada' },
  activo:     { label: 'Activa (legacy)', className: 'bg-green-100 text-green-700', desc: '' },
}

type ProductoCatalogo = {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  tiene_lote: boolean
  tiene_vencimiento: boolean
}

export default function ComprasPage() {
  const supabase = createClient()

  const [compras, setCompras] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [proveedores, setProveedores] = useState<any[]>([])
  const [productos, setProductos] = useState<ProductoCatalogo[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailCompra, setDetailCompra] = useState<any>(null)
  const [detailItems, setDetailItems] = useState<any[]>([])
  const [editMode, setEditMode] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    proveedor_id: '',
    numero_factura: '',
    fecha: '',
    metodo_valorizacion: 'promedio' as 'promedio' | 'fifo' | 'directo',
    incluir_igv: true,
  })

  // Validación de recepción (registrada → recibida)
  const [validarOpen, setValidarOpen] = useState(false)
  const [validarSaving, setValidarSaving] = useState(false)
  const [itemsRecepcion, setItemsRecepcion] = useState<Array<{ id: string; producto: string; cantidad: number; cantidad_recibida: number; precio_unitario: number }>>([])
  const [transicionando, setTransicionando] = useState(false)

  // Edición de ítems (solo en estado registrada)
  const [editItemsMode, setEditItemsMode] = useState(false)
  const [editItemsSaving, setEditItemsSaving] = useState(false)
  const [itemsEditables, setItemsEditables] = useState<Array<{ id: string; producto: string; cantidad: number; precio_unitario: number; lote_numero: string; lote_fecha_vencimiento: string }>>([])

  // Buscadores con autocompletado (proveedor + productos por línea)
  const [proveedorSearch, setProveedorSearch] = useState('')
  const debouncedProvSearch = useDebounce(proveedorSearch, 200)
  const [showProveedorDropdown, setShowProveedorDropdown] = useState(false)
  const [productoSearchByIdx, setProductoSearchByIdx] = useState<Record<number, string>>({})
  const [showProductoDropdownIdx, setShowProductoDropdownIdx] = useState<number | null>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const productoInputRefs = useRef<Record<number, HTMLDivElement | null>>({})

  // Helper para calcular la posición de un dropdown a partir del ref del input.
  // Devuelve true si pudo posicionarlo.
  const calcularDropdownPos = useCallback((idx: number): boolean => {
    const el = productoInputRefs.current[idx]
    if (!el) return false
    const rect = el.getBoundingClientRect()
    const maxHeight = 288
    const spaceBelow = window.innerHeight - rect.bottom
    // Si no cabe abajo y sí arriba, abrir hacia arriba
    const finalTop = spaceBelow < maxHeight && rect.top > maxHeight
      ? Math.max(8, rect.top - maxHeight - 4)
      : rect.bottom + 4
    setDropdownPos({ top: finalTop, left: rect.left, width: rect.width })
    return true
  }, [])

  // Re-calcular posición en scroll/resize cuando está abierto
  useEffect(() => {
    if (showProductoDropdownIdx === null) { setDropdownPos(null); return }
    const onScrollOrResize = () => calcularDropdownPos(showProductoDropdownIdx as number)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [showProductoDropdownIdx, calcularDropdownPos])

  const { register, handleSubmit, watch, setValue, control, reset, formState: { errors } } = useForm<CompraFormData>({
    resolver: zodResolver(compraSchema) as any,
    defaultValues: {
      tipo: 'directa',
      metodo_valorizacion: 'promedio',
      fecha: new Date().toISOString().split('T')[0],
      items: [{ producto_id: '', cantidad: 0, precio_unitario: 0, total_linea: 0, lote_numero: '', lote_fecha_fabricacion: '', lote_fecha_vencimiento: '' }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchItems = watch('items')
  const watchProveedorId = watch('proveedor_id')

  const [incluirIgv, setIncluirIgv] = useState(true)
  const [modoIngreso, setModoIngreso] = useState<'unitario' | 'total'>('unitario')

  // Cargar última preferencia del usuario
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('compras_modo_ingreso') : null
    if (saved === 'total' || saved === 'unitario') setModoIngreso(saved)
  }, [])
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('compras_modo_ingreso', modoIngreso)
  }, [modoIngreso])

  // Los precios de proveedor/lista YA incluyen IGV. El total es lo que se paga;
  // el subtotal (base imponible) se desglosa hacia atrás.
  const totalConIgv = watchItems?.reduce(
    (acc, item) => acc + (Number(item.cantidad) || 0) * (Number(item.precio_unitario) || 0),
    0
  ) ?? 0
  const subtotal = incluirIgv ? totalConIgv / (1 + IGV_RATE) : totalConIgv
  const igv = incluirIgv ? totalConIgv - subtotal : 0
  const totalCompra = totalConIgv

  // Helpers de cálculo entre modos. Precio unitario y total línea ambos
  // expresados con IGV incluido (la convención del cliente).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const calcPUnitDesdeTotal = (totalLinea: number, cantidad: number, _igvIncluido: boolean) => {
    if (cantidad <= 0) return 0
    return totalLinea / cantidad
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const calcTotalLineaDesdePUnit = (pUnit: number, cantidad: number, _igvIncluido: boolean) => {
    return pUnit * cantidad
  }

  // Cuando cambia el toggle IGV en modo total: mantener los totales línea y recalcular p.unit
  useEffect(() => {
    if (modoIngreso !== 'total' || !watchItems) return
    watchItems.forEach((it, idx) => {
      const tot = Number(it.total_linea ?? 0)
      const cant = Number(it.cantidad ?? 0)
      if (tot > 0 && cant > 0) {
        const nuevoPUnit = calcPUnitDesdeTotal(tot, cant, incluirIgv)
        setValue(`items.${idx}.precio_unitario`, nuevoPUnit)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incluirIgv])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: c, count }, { data: p }, { data: pr }] = await Promise.all([
      supabase
        .from('compras')
        .select(`id, numero_factura_proveedor, fecha, total, estado, proveedores(razon_social)`, { count: 'exact' })
        .order('fecha', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1),
      supabase.from('proveedores').select('id, razon_social, ruc').eq('activo', true).order('razon_social'),
      supabase.from('productos').select('id, codigo, nombre, descripcion, tiene_lote, tiene_vencimiento, stock(cantidad), unidades_medida(simbolo)').eq('activo', true).order('nombre'),
    ])
    setCompras(c ?? [])
    setTotal(count ?? 0)
    setProveedores(p ?? [])
    setProductos(((pr ?? []) as any[]).map((p: any) => ({
      ...p,
      stock_cantidad: Number(p.stock?.[0]?.cantidad ?? p.stock?.cantidad ?? 0),
      um: p.unidades_medida?.simbolo ?? '',
    })) as any[])
    setLoading(false)
  }, [page])

  useEffect(() => { loadData() }, [loadData])

  // Resetear los buscadores cuando se abre/cierra el modal de Nueva Compra
  useEffect(() => {
    if (!dialogOpen) {
      setProveedorSearch('')
      setProductoSearchByIdx({})
      setShowProveedorDropdown(false)
      setShowProductoDropdownIdx(null)
    }
  }, [dialogOpen])

  const onSubmit = async (data: CompraFormData) => {
    // Validación previa: lote_numero obligatorio si producto tiene_lote
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]
      const prod = productos.find((p) => p.id === item.producto_id)
      if (!prod) continue
      if (prod.tiene_lote && !item.lote_numero?.trim()) {
        toast.error('Lote requerido', {
          description: `El producto "${(prod as any).descripcion?.trim() || prod.nombre}" requiere número de lote.`,
        })
        return
      }
    }

    setSaving(true)

    // Precios c/IGV → desglosar hacia atrás
    const totalConIgvCalc = data.items.reduce(
      (acc, item) => acc + item.cantidad * item.precio_unitario, 0
    )
    const subtotalCalc = incluirIgv ? totalConIgvCalc / (1 + IGV_RATE) : totalConIgvCalc
    const igvCalc = incluirIgv ? totalConIgvCalc - subtotalCalc : 0
    const totalFinalCalc = totalConIgvCalc

    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData?.user?.id ?? null

      // 1. Insertar cabecera en compras (estado='registrada', sin impactar almacén)
      const { data: compra, error } = await (supabase.from('compras') as any).insert({
        proveedor_id: data.proveedor_id,
        numero_factura_proveedor: data.numero_factura,
        fecha: data.fecha,
        metodo_valorizacion: data.metodo_valorizacion,
        subtotal: subtotalCalc,
        igv: igvCalc,
        incluir_igv: incluirIgv,
        total: totalFinalCalc,
        moneda: 'PEN',
        estado: 'registrada',
        created_by: userId,
      }).select().single()

      if (error || !compra) {
        throw new Error(error?.message ?? 'No se pudo crear la compra.')
      }

      // 2. Insertar items con cantidad facturada + lote_numero como texto
      //    Los lotes reales se crean al aplicar la compra (función aplicar_compra)
      const itemsToInsert = data.items.map((item) => ({
        compra_id: compra.id,
        producto_id: item.producto_id,
        lote_id: null,
        lote_numero: item.lote_numero?.trim() || null,
        lote_fecha_vencimiento: item.lote_fecha_vencimiento || null,
        cantidad: item.cantidad,
        cantidad_recibida: null,
        precio_unitario: item.precio_unitario,
        subtotal: item.cantidad * item.precio_unitario,
      }))

      const { error: itemsError } = await (supabase.from('compras_items') as any).insert(itemsToInsert)
      if (itemsError) throw new Error(itemsError.message)

      toast.success('Compra registrada', {
        description: `Factura ${data.numero_factura} · Total ${formatCurrency(subtotalCalc + igvCalc)} · Estado: Registrada (pendiente validación)`,
      })
      setDialogOpen(false)
      setIncluirIgv(true)
      reset()
      loadData()
    } catch (err: any) {
      toast.error('Error al registrar compra', { description: err?.message ?? 'No se pudo guardar.' })
    } finally {
      setSaving(false)
    }
  }

  const openDetail = async (compraId: string) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setEditMode(false)
    setDetailCompra(null)
    setDetailItems([])
    try {
      const [{ data: compra }, { data: items }] = await Promise.all([
        supabase
          .from('compras')
          .select(`
            id, numero_factura_proveedor, fecha, total, subtotal, igv, incluir_igv,
            metodo_valorizacion, moneda, estado, created_at, proveedor_id,
            proveedores(id, razon_social, ruc, pais)
          `)
          .eq('id', compraId)
          .single(),
        supabase
          .from('compras_items')
          .select(`
            id, cantidad, precio_unitario, subtotal,
            productos(id, codigo, nombre, descripcion, unidades_medida(simbolo)),
            lotes(id, numero_lote, fecha_vencimiento)
          `)
          .eq('compra_id', compraId)
          .order('id'),
      ])
      setDetailCompra(compra)
      setDetailItems(items ?? [])
      if (compra) {
        setEditForm({
          proveedor_id: compra.proveedor_id ?? '',
          numero_factura: compra.numero_factura_proveedor ?? '',
          fecha: compra.fecha ?? '',
          metodo_valorizacion: (compra.metodo_valorizacion as any) ?? 'promedio',
          incluir_igv: compra.incluir_igv ?? true,
        })
      }
    } catch (err: any) {
      toast.error('No se pudo cargar el detalle', { description: err?.message })
    } finally {
      setDetailLoading(false)
    }
  }

  const guardarEdicionCabecera = async () => {
    if (!detailCompra) return
    if (!editForm.proveedor_id || !editForm.numero_factura.trim() || !editForm.fecha) {
      toast.error('Completa proveedor, factura y fecha')
      return
    }
    setEditSaving(true)
    try {
      // El total (lo que se paga) no cambia al togglar IGV. Solo cambia el desglose.
      const totalActual = Number(detailCompra.total ?? 0)
      const subtotalNuevo = editForm.incluir_igv ? totalActual / (1 + IGV_RATE) : totalActual
      const igvNuevo = editForm.incluir_igv ? totalActual - subtotalNuevo : 0
      const totalNuevo = totalActual

      const { error } = await (supabase.from('compras') as any)
        .update({
          proveedor_id: editForm.proveedor_id,
          numero_factura_proveedor: editForm.numero_factura.trim(),
          fecha: editForm.fecha,
          metodo_valorizacion: editForm.metodo_valorizacion,
          incluir_igv: editForm.incluir_igv,
          subtotal: subtotalNuevo,
          igv: igvNuevo,
          total: totalNuevo,
        })
        .eq('id', detailCompra.id)
      if (error) throw error

      toast.success('Compra actualizada', { description: 'Los cambios de cabecera se guardaron.' })
      setEditMode(false)
      await openDetail(detailCompra.id)
      loadData()
    } catch (err: any) {
      toast.error('No se pudo guardar', { description: err?.message })
    } finally {
      setEditSaving(false)
    }
  }

  // ─── Transiciones de estado ───────────────────────────────────────────
  const abrirValidacion = async () => {
    if (!detailCompra) return
    setItemsRecepcion(
      detailItems.map((it: any) => ({
        id: it.id,
        producto: it.productos?.descripcion?.trim() || it.productos?.nombre || '—',
        cantidad: Number(it.cantidad),
        cantidad_recibida: Number(it.cantidad_recibida ?? it.cantidad),
        precio_unitario: Number(it.precio_unitario),
      })),
    )
    setValidarOpen(true)
  }

  const confirmarRecepcion = async () => {
    if (!detailCompra) return
    setValidarSaving(true)
    try {
      // Update cada item con cantidad_recibida
      for (const it of itemsRecepcion) {
        const { error } = await (supabase.from('compras_items') as any)
          .update({ cantidad_recibida: it.cantidad_recibida })
          .eq('id', it.id)
        if (error) throw error
      }
      // Cambiar estado a recibida
      const { error: estErr } = await (supabase.from('compras') as any)
        .update({ estado: 'recibida' })
        .eq('id', detailCompra.id)
      if (estErr) throw estErr

      toast.success('Recepción confirmada', {
        description: 'La compra pasó a estado "Recibida". Ahora puede aplicarse al almacén.',
      })
      setValidarOpen(false)
      await openDetail(detailCompra.id)
      loadData()
    } catch (err: any) {
      toast.error('No se pudo validar recepción', { description: err?.message })
    } finally {
      setValidarSaving(false)
    }
  }

  const aplicarCompra = async () => {
    if (!detailCompra) return
    setTransicionando(true)
    try {
      const { data, error } = await (supabase.rpc as any)('aplicar_compra', { p_compra_id: detailCompra.id })
      if (error) throw error
      const ncId = data?.[0]?.nota_credito_id
      const ncTotal = Number(data?.[0]?.nota_credito_total ?? 0)
      if (ncId && ncTotal > 0) {
        toast.success('Compra aplicada', {
          description: `Stock y costos actualizados. Se generó NC de compra por ${formatCurrency(ncTotal)} por diferencias de recepción.`,
        })
      } else {
        toast.success('Compra aplicada', { description: 'Stock, lotes y costo promedio actualizados.' })
      }
      await openDetail(detailCompra.id)
      loadData()
    } catch (err: any) {
      toast.error('No se pudo aplicar la compra', { description: err?.message })
    } finally {
      setTransicionando(false)
    }
  }

  const revertirCompra = async () => {
    if (!detailCompra) return
    if (!confirm('¿Revertir esta compra? Se descontará el stock ingresado, los lotes asociados y la NC se eliminará.')) return
    setTransicionando(true)
    try {
      const { error } = await (supabase.rpc as any)('revertir_compra', { p_compra_id: detailCompra.id })
      if (error) throw error
      toast.success('Compra revertida', { description: 'Volvió a estado "Registrada" para edición.' })
      await openDetail(detailCompra.id)
      loadData()
    } catch (err: any) {
      toast.error('No se pudo revertir', { description: err?.message })
    } finally {
      setTransicionando(false)
    }
  }

  const volverARegistrada = async () => {
    if (!detailCompra) return
    setTransicionando(true)
    try {
      const { error } = await (supabase.from('compras') as any)
        .update({ estado: 'registrada' })
        .eq('id', detailCompra.id)
      if (error) throw error
      toast.success('Compra vuelta a registrada', { description: 'Ahora puedes editar los ítems antes de validar la recepción nuevamente.' })
      await openDetail(detailCompra.id)
      loadData()
    } catch (err: any) {
      toast.error('No se pudo cambiar estado', { description: err?.message })
    } finally {
      setTransicionando(false)
    }
  }

  const abrirEditItems = () => {
    if (!detailCompra) return
    setItemsEditables(
      detailItems.map((it: any) => ({
        id: it.id,
        producto: it.productos?.descripcion?.trim() || it.productos?.nombre || '—',
        cantidad: Number(it.cantidad),
        precio_unitario: Number(it.precio_unitario),
        lote_numero: it.lote_numero ?? '',
        lote_fecha_vencimiento: it.lote_fecha_vencimiento ?? '',
      })),
    )
    setEditItemsMode(true)
  }

  const guardarEdicionItems = async () => {
    if (!detailCompra) return
    // Validar
    for (const it of itemsEditables) {
      if (it.cantidad <= 0) { toast.error('Cantidad inválida', { description: it.producto }); return }
      if (it.precio_unitario < 0) { toast.error('Precio inválido', { description: it.producto }); return }
    }
    setEditItemsSaving(true)
    try {
      // precio_unitario YA incluye IGV → totalConIgv es la suma directa
      let totalConIgvNuevo = 0
      for (const it of itemsEditables) {
        const subt = it.cantidad * it.precio_unitario
        totalConIgvNuevo += subt
        const { error } = await (supabase.from('compras_items') as any)
          .update({
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
            subtotal: subt,
            lote_numero: it.lote_numero.trim() || null,
            lote_fecha_vencimiento: it.lote_fecha_vencimiento || null,
          })
          .eq('id', it.id)
        if (error) throw error
      }
      const subtotalNuevo = detailCompra.incluir_igv ? totalConIgvNuevo / (1 + IGV_RATE) : totalConIgvNuevo
      const igvNuevo = detailCompra.incluir_igv ? totalConIgvNuevo - subtotalNuevo : 0
      const totalNuevo = totalConIgvNuevo
      const { error: cErr } = await (supabase.from('compras') as any)
        .update({ subtotal: subtotalNuevo, igv: igvNuevo, total: totalNuevo })
        .eq('id', detailCompra.id)
      if (cErr) throw cErr

      toast.success('Productos actualizados', { description: `Nuevo total: ${formatCurrency(totalNuevo)}` })
      setEditItemsMode(false)
      await openDetail(detailCompra.id)
      loadData()
    } catch (err: any) {
      toast.error('No se pudo guardar', { description: err?.message })
    } finally {
      setEditItemsSaving(false)
    }
  }

  const anularCompra = async () => {
    if (!detailCompra) return
    if (detailCompra.estado === 'aplicada') {
      toast.error('Primero revertir', { description: 'Una compra aplicada debe revertirse antes de anular.' })
      return
    }
    if (!confirm('¿Anular esta compra? Esta acción no se puede deshacer.')) return
    setTransicionando(true)
    try {
      const { error } = await (supabase.from('compras') as any)
        .update({ estado: 'anulado' })
        .eq('id', detailCompra.id)
      if (error) throw error
      toast.success('Compra anulada')
      await openDetail(detailCompra.id)
      loadData()
    } catch (err: any) {
      toast.error('No se pudo anular', { description: err?.message })
    } finally {
      setTransicionando(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compras</h1>
          <p className="text-sm text-gray-500 mt-0.5">Registro de compras y facturas de proveedores</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
          <Plus className="w-4 h-4" /> Nueva Compra
        </Button>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : compras.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <ShoppingCart className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No hay compras registradas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Factura', 'Proveedor', 'Fecha', 'Total', 'Estado', 'Acciones'].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {compras.map((c) => {
                    const estadoCfg = ESTADO_CONFIG[c.estado] ?? ESTADO_CONFIG.activo
                    return (
                      <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs text-gray-600">{c.numero_factura_proveedor ?? '—'}</td>
                        <td className="py-3 px-4 font-medium text-gray-900">{(c.proveedores as any)?.razon_social ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs">
                          {c.fecha ? formatDate(c.fecha) : '—'}
                        </td>
                        <td className="py-3 px-4 font-semibold text-gray-800">{formatCurrency(c.total ?? 0)}</td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${estadoCfg.className}`}>
                            {estadoCfg.label}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDetail(c.id)}
                            className="h-7 gap-1 text-xs"
                            title="Ver detalle"
                          >
                            <Eye className="w-3.5 h-3.5 text-gray-500" /> Ver
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">{total} compras en total</p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="h-7 w-7 p-0">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-sm text-gray-600 px-2">{page + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1} className="h-7 w-7 p-0">
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog Nueva Compra */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar Nueva Compra</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-5 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Proveedor *</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Buscar por razón social o RUC..."
                    value={proveedorSearch}
                    onChange={(e) => {
                      setProveedorSearch(e.target.value)
                      setShowProveedorDropdown(true)
                      // Si el usuario edita, deseleccionar
                      if (watchProveedorId) setValue('proveedor_id', '')
                    }}
                    onFocus={() => setShowProveedorDropdown(true)}
                    onBlur={() => setTimeout(() => setShowProveedorDropdown(false), 150)}
                    className="pl-9"
                  />
                  {showProveedorDropdown && (() => {
                    const q = debouncedProvSearch.toLowerCase().trim()
                    const lista = q.length >= 1
                      ? proveedores.filter((p: any) =>
                          (p.razon_social ?? '').toLowerCase().includes(q) ||
                          (p.ruc ?? '').toLowerCase().includes(q)
                        ).slice(0, 8)
                      : proveedores.slice(0, 8)
                    if (lista.length === 0) return null
                    return (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-30 mt-1 overflow-hidden max-h-64 overflow-y-auto">
                        {lista.map((p: any) => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              setValue('proveedor_id', p.id)
                              setProveedorSearch(p.razon_social)
                              setShowProveedorDropdown(false)
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-green-50 border-b border-gray-100 last:border-0"
                          >
                            <div className="font-medium text-gray-900 text-sm truncate">{p.razon_social}</div>
                            {p.ruc && <div className="text-xs text-gray-500 font-mono">{p.ruc}</div>}
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                </div>
                {errors.proveedor_id && <p className="text-xs text-red-500 mt-1">{errors.proveedor_id.message}</p>}
              </div>
              <div>
                <Label>Tipo de Compra</Label>
                <Select defaultValue="directa" onValueChange={(v) => setValue('tipo', v as 'directa' | 'con_oc')}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="directa">Directa</SelectItem>
                    <SelectItem value="con_oc">Con Orden de Compra</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>N° Factura Proveedor *</Label>
                <Input {...register('numero_factura')} placeholder="F001-00001" className="mt-1" />
                {errors.numero_factura && <p className="text-xs text-red-500 mt-1">{errors.numero_factura.message}</p>}
              </div>
              <div>
                <Label>Fecha *</Label>
                <Input {...register('fecha')} type="date" className="mt-1" />
              </div>
              <div>
                <Label>Método Valorización</Label>
                <Select defaultValue="promedio" onValueChange={(v) => setValue('metodo_valorizacion', v as 'promedio' | 'fifo' | 'directo')}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="promedio">Promedio</SelectItem>
                    <SelectItem value="fifo">FIFO</SelectItem>
                    <SelectItem value="directo">Directo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Productos</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ producto_id: '', cantidad: 0, precio_unitario: 0, total_linea: 0, lote_numero: '', lote_fecha_fabricacion: '', lote_fecha_vencimiento: '' })}
                  className="h-7 gap-1 text-xs"
                >
                  <Plus className="w-3 h-3" /> Agregar
                </Button>
              </div>

              {/* Toggle modo de ingreso */}
              <div className="flex items-center justify-between mb-2 px-3 py-2 bg-blue-50/60 border border-blue-100 rounded-lg">
                <div>
                  <p className="text-xs font-medium text-blue-900">Modo de ingreso</p>
                  <p className="text-[10px] text-blue-700">
                    {modoIngreso === 'unitario'
                      ? 'Ingresas el precio unitario · el sistema calcula el total'
                      : 'Ingresas el total de la línea (con IGV) · el sistema desglosa el unitario'}
                  </p>
                </div>
                <div className="inline-flex rounded-md border border-blue-200 bg-white p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setModoIngreso('unitario')}
                    className={`px-2.5 py-1 rounded ${modoIngreso === 'unitario' ? 'bg-blue-600 text-white font-semibold' : 'text-blue-700 hover:bg-blue-50'}`}
                  >
                    Por unitario
                  </button>
                  <button
                    type="button"
                    onClick={() => setModoIngreso('total')}
                    className={`px-2.5 py-1 rounded ${modoIngreso === 'total' ? 'bg-blue-600 text-white font-semibold' : 'text-blue-700 hover:bg-blue-50'}`}
                  >
                    Por total
                  </button>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg">
                <div className="divide-y divide-gray-100">
                  {fields.map((field, idx) => {
                    const cant = Number(watchItems?.[idx]?.cantidad) || 0
                    const precio = Number(watchItems?.[idx]?.precio_unitario) || 0
                    const productoId = watchItems?.[idx]?.producto_id
                    const prod = productos.find((p) => p.id === productoId)
                    const requiereLote = prod?.tiene_lote || prod?.tiene_vencimiento
                    return (
                      <div key={field.id} className="p-3 bg-white relative">
                        <div className="grid grid-cols-12 gap-2 items-start">
                          <div className="col-span-5">
                            <Label className="text-[10px] text-gray-500">Producto</Label>
                            <div
                              ref={(el) => { productoInputRefs.current[idx] = el }}
                              className="relative mt-1 flex gap-1"
                            >
                              <div className="relative flex-1">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                                <Input
                                  type="text"
                                  placeholder={prod ? '' : 'Buscar por nombre o código...'}
                                  value={productoSearchByIdx[idx] ?? (prod ? (prod.descripcion?.trim() || prod.nombre) : '')}
                                  onChange={(e) => {
                                    setProductoSearchByIdx((prev) => ({ ...prev, [idx]: e.target.value }))
                                    calcularDropdownPos(idx)
                                    setShowProductoDropdownIdx(idx)
                                    if (productoId) setValue(`items.${idx}.producto_id`, '')
                                  }}
                                  onFocus={() => {
                                    calcularDropdownPos(idx)
                                    setShowProductoDropdownIdx(idx)
                                  }}
                                  onBlur={() => setTimeout(() => setShowProductoDropdownIdx((cur) => cur === idx ? null : cur), 150)}
                                  className="h-8 text-xs pl-7"
                                />
                              </div>
                              <button
                                type="button"
                                title="Ver todos los productos"
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  if (showProductoDropdownIdx === idx) {
                                    setShowProductoDropdownIdx(null)
                                  } else {
                                    setProductoSearchByIdx((prev) => ({ ...prev, [idx]: '' }))
                                    calcularDropdownPos(idx)
                                    setShowProductoDropdownIdx(idx)
                                  }
                                }}
                                className="h-8 w-8 flex items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-50 shrink-0"
                              >
                                <ChevronLeft className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showProductoDropdownIdx === idx ? 'rotate-90' : '-rotate-90'}`} />
                              </button>
                            </div>
                          </div>
                          <div className="col-span-2">
                            <Label className="text-[10px] text-gray-500">Cantidad</Label>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              placeholder="0"
                              value={Number(watchItems?.[idx]?.cantidad ?? 0) > 0 ? watchItems[idx].cantidad : ''}
                              onChange={(e) => {
                                const val = e.target.value
                                const nuevaCant = val === '' ? 0 : (parseFloat(val) || 0)
                                setValue(`items.${idx}.cantidad`, nuevaCant)
                                if (modoIngreso === 'total') {
                                  const tot = Number(watchItems?.[idx]?.total_linea ?? 0)
                                  if (tot > 0) {
                                    setValue(`items.${idx}.precio_unitario`, calcPUnitDesdeTotal(tot, nuevaCant, incluirIgv))
                                  }
                                }
                              }}
                              onFocus={(e) => e.target.select()}
                              className="h-8 text-xs mt-1"
                            />
                          </div>
                          {modoIngreso === 'unitario' ? (
                            <div className="col-span-2">
                              <Label className="text-[10px] text-gray-500">P. Unit.</Label>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                placeholder="0.00"
                                value={Number(watchItems?.[idx]?.precio_unitario ?? 0) > 0 ? watchItems[idx].precio_unitario : ''}
                                onChange={(e) => {
                                  const val = e.target.value
                                  const v = val === '' ? 0 : (parseFloat(val) || 0)
                                  setValue(`items.${idx}.precio_unitario`, v)
                                  setValue(`items.${idx}.total_linea`, calcTotalLineaDesdePUnit(v, cant, incluirIgv))
                                }}
                                onFocus={(e) => e.target.select()}
                                className="h-8 text-xs mt-1"
                              />
                            </div>
                          ) : (
                            <div className="col-span-2">
                              <Label className="text-[10px] text-gray-500">Total línea {incluirIgv ? '(c/IGV)' : ''}</Label>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                placeholder="0.00"
                                value={Number(watchItems?.[idx]?.total_linea ?? 0) > 0 ? watchItems[idx].total_linea : ''}
                                onChange={(e) => {
                                  const val = e.target.value
                                  const tot = val === '' ? 0 : (parseFloat(val) || 0)
                                  setValue(`items.${idx}.total_linea`, tot)
                                  setValue(`items.${idx}.precio_unitario`, calcPUnitDesdeTotal(tot, cant, incluirIgv))
                                }}
                                onFocus={(e) => e.target.select()}
                                className="h-8 text-xs mt-1 bg-blue-50/50 border-blue-200"
                              />
                            </div>
                          )}
                          <div className="col-span-2">
                            <Label className="text-[10px] text-gray-500">
                              {modoIngreso === 'unitario' ? 'Subtotal' : 'P.Unit (calc.)'}
                            </Label>
                            <p className="h-8 text-xs mt-1 font-medium text-gray-700 flex items-center">
                              {modoIngreso === 'unitario'
                                ? formatCurrency(cant * precio)
                                : `${formatCurrency(precio)} c/u`}
                            </p>
                          </div>
                          <div className="col-span-1 pt-5">
                            {fields.length > 1 && (
                              <button type="button" onClick={() => remove(idx)} className="text-red-400 hover:text-red-600">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Inputs de lote / vencimiento */}
                        {requiereLote && (
                          <div className="mt-2 ml-1 p-2.5 bg-amber-50/50 border border-amber-200 rounded-lg">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <Package2 className="w-3.5 h-3.5 text-amber-600" />
                              <span className="text-[11px] font-medium text-amber-800">
                                Control de lote / vencimiento requerido
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <Label className="text-[10px] text-gray-600">
                                  N° de Lote {prod?.tiene_lote && <span className="text-red-500">*</span>}
                                </Label>
                                <Input
                                  {...register(`items.${idx}.lote_numero`)}
                                  placeholder="L-001"
                                  className="h-8 text-xs mt-1"
                                />
                              </div>
                              {prod?.tiene_vencimiento && (
                                <>
                                  <div>
                                    <Label className="text-[10px] text-gray-600">Fecha fabricación</Label>
                                    <Input
                                      {...register(`items.${idx}.lote_fecha_fabricacion`)}
                                      type="date"
                                      className="h-8 text-xs mt-1"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-[10px] text-gray-600">Fecha vencimiento</Label>
                                    <Input
                                      {...register(`items.${idx}.lote_fecha_vencimiento`)}
                                      type="date"
                                      className="h-8 text-xs mt-1"
                                    />
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              {errors.items && <p className="text-xs text-red-500 mt-1">{errors.items.message}</p>}
            </div>

            {/* Toggle IGV */}
            <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
              <div>
                <p className="text-sm font-medium text-blue-900">Aplica IGV (18%)</p>
                <p className="text-[11px] text-blue-700">Desactivar para compras exoneradas o sin IGV</p>
              </div>
              <button
                type="button"
                onClick={() => setIncluirIgv(!incluirIgv)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${incluirIgv ? 'bg-green-500' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${incluirIgv ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {/* Totales */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">IGV (18%) {!incluirIgv && <span className="text-amber-600 text-xs">· desactivado</span>}</span>
                <span className="font-medium">{formatCurrency(igv)}</span>
              </div>
              <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2 mt-2">
                <span>Total</span>
                <span className="text-green-600">{formatCurrency(totalCompra)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Registrar Compra
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Detalle / Editar Cabecera */}
      <Dialog open={detailOpen} onOpenChange={(o) => { setDetailOpen(o); if (!o) setEditMode(false) }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-green-600" />
              {editMode ? 'Editar Compra' : 'Detalle de Compra'}
            </DialogTitle>
          </DialogHeader>

          {detailLoading || !detailCompra ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : (
            <div className="space-y-5 mt-2">
              {/* Cabecera */}
              {editMode ? (
                <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-4 space-y-3">
                  <p className="text-xs text-amber-800 font-medium">
                    Solo puedes editar datos de cabecera. Los productos, cantidades y lotes ya afectaron el stock y no se modifican aquí.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Proveedor *</Label>
                      <Select value={editForm.proveedor_id} onValueChange={(v) => setEditForm((f) => ({ ...f, proveedor_id: v }))}>
                        <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                        <SelectContent>
                          {proveedores.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.razon_social}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">N° Factura *</Label>
                      <Input
                        value={editForm.numero_factura}
                        onChange={(e) => setEditForm((f) => ({ ...f, numero_factura: e.target.value }))}
                        className="mt-1 h-9 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Fecha *</Label>
                      <Input
                        type="date"
                        value={editForm.fecha}
                        onChange={(e) => setEditForm((f) => ({ ...f, fecha: e.target.value }))}
                        className="mt-1 h-9 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Método Valorización</Label>
                      <Select value={editForm.metodo_valorizacion} onValueChange={(v) => setEditForm((f) => ({ ...f, metodo_valorizacion: v as any }))}>
                        <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="promedio">Promedio</SelectItem>
                          <SelectItem value="fifo">FIFO</SelectItem>
                          <SelectItem value="directo">Directo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center justify-between bg-white border border-amber-200 rounded px-3 py-2">
                    <div>
                      <p className="text-xs font-medium text-gray-900">Aplica IGV (18%)</p>
                      <p className="text-[10px] text-gray-500">Al cambiar se recalcula el total</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditForm((f) => ({ ...f, incluir_igv: !f.incluir_igv }))}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${editForm.incluir_igv ? 'bg-green-500' : 'bg-gray-300'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${editForm.incluir_igv ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-start gap-2.5">
                    <Building2 className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-500 uppercase tracking-wide">Proveedor</p>
                      <p className="text-sm font-medium text-gray-900 truncate">{(detailCompra.proveedores as any)?.razon_social ?? '—'}</p>
                      {(detailCompra.proveedores as any)?.ruc && (
                        <p className="text-[11px] text-gray-500 font-mono">{(detailCompra.proveedores as any).ruc}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <FileText className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-500 uppercase tracking-wide">N° Factura</p>
                      <p className="text-sm font-mono text-gray-900">{detailCompra.numero_factura_proveedor ?? '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Calendar className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[11px] text-gray-500 uppercase tracking-wide">Fecha</p>
                      <p className="text-sm text-gray-900">{detailCompra.fecha ? formatDate(detailCompra.fecha) : '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Package2 className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[11px] text-gray-500 uppercase tracking-wide">Método Valorización</p>
                      <p className="text-sm text-gray-900 capitalize">{detailCompra.metodo_valorizacion ?? '—'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-semibold text-gray-700">
                    Productos ({editItemsMode ? itemsEditables.length : detailItems.length})
                  </Label>
                  {!editItemsMode && !editMode && detailCompra.estado === 'registrada' && (
                    <Button variant="outline" size="sm" onClick={abrirEditItems} className="h-7 text-xs">
                      Editar productos
                    </Button>
                  )}
                </div>

                {editItemsMode ? (
                  <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-3 space-y-2">
                    <p className="text-[11px] text-amber-800 font-medium">
                      Editando cantidades y precios facturados. El stock NO se ve afectado todavía
                      (la compra sigue en estado registrada).
                    </p>
                    <div className="border border-amber-200 rounded overflow-hidden bg-white">
                      <table className="w-full text-sm">
                        <thead className="bg-amber-50 border-b border-amber-100">
                          <tr>
                            <th className="text-left py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase">Producto</th>
                            <th className="text-right py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase w-20">Cant.</th>
                            <th className="text-right py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase w-24">P. Unit.</th>
                            <th className="text-left py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase w-28">N° Lote</th>
                            <th className="text-left py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase w-32">Vence</th>
                            <th className="text-right py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase w-24">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {itemsEditables.map((it, idx) => (
                            <tr key={it.id}>
                              <td className="py-1.5 px-2 text-sm text-gray-900 max-w-[200px] truncate">{it.producto}</td>
                              <td className="py-1.5 px-2">
                                <Input type="number" min={0.01} step="0.01" value={it.cantidad}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value) || 0
                                    setItemsEditables((p) => p.map((r, i) => i === idx ? { ...r, cantidad: v } : r))
                                  }}
                                  className="h-7 text-xs text-right font-mono" />
                              </td>
                              <td className="py-1.5 px-2">
                                <Input type="number" min={0} step="0.01" value={it.precio_unitario}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value) || 0
                                    setItemsEditables((p) => p.map((r, i) => i === idx ? { ...r, precio_unitario: v } : r))
                                  }}
                                  className="h-7 text-xs text-right font-mono" />
                              </td>
                              <td className="py-1.5 px-2">
                                <Input value={it.lote_numero} placeholder="(sin lote)"
                                  onChange={(e) => setItemsEditables((p) => p.map((r, i) => i === idx ? { ...r, lote_numero: e.target.value } : r))}
                                  className="h-7 text-xs font-mono" />
                              </td>
                              <td className="py-1.5 px-2">
                                <Input type="date" value={it.lote_fecha_vencimiento}
                                  onChange={(e) => setItemsEditables((p) => p.map((r, i) => i === idx ? { ...r, lote_fecha_vencimiento: e.target.value } : r))}
                                  className="h-7 text-xs" />
                              </td>
                              <td className="py-1.5 px-2 text-right font-medium text-sm text-gray-900 font-mono">
                                {formatCurrency(it.cantidad * it.precio_unitario)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button variant="outline" size="sm" onClick={() => setEditItemsMode(false)} disabled={editItemsSaving}>
                        Cancelar edición
                      </Button>
                      <Button size="sm" onClick={guardarEdicionItems} disabled={editItemsSaving}
                        className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                        {editItemsSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Guardar productos
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="text-left py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Producto</th>
                          <th className="text-right py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Cant.</th>
                          {detailCompra.estado === 'aplicada' && (
                            <th className="text-right py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Recib.</th>
                          )}
                          <th className="text-right py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">P. Unit.</th>
                          <th className="text-right py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {detailItems.map((it) => {
                          const prod = it.productos as any
                          const lote = it.lotes as any
                          const um = prod?.unidades_medida?.simbolo ?? ''
                          const nombreProd = prod?.descripcion?.trim() || prod?.nombre || '—'
                          const cantR = it.cantidad_recibida
                          const diff = cantR != null ? Number(it.cantidad) - Number(cantR) : 0
                          return (
                            <tr key={it.id}>
                              <td className="py-2.5 px-3">
                                <p className="font-medium text-gray-900">{nombreProd}</p>
                                {(lote || it.lote_numero) && (
                                  <p className="text-[11px] text-amber-700 mt-0.5">
                                    Lote {lote?.numero_lote ?? it.lote_numero}
                                    {(lote?.fecha_vencimiento || it.lote_fecha_vencimiento) &&
                                      ` · vence ${formatDate(lote?.fecha_vencimiento ?? it.lote_fecha_vencimiento)}`}
                                  </p>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right text-gray-700">{Number(it.cantidad).toFixed(2)} {um}</td>
                              {detailCompra.estado === 'aplicada' && (
                                <td className="py-2.5 px-3 text-right text-gray-700">
                                  {cantR != null ? Number(cantR).toFixed(2) : '—'}
                                  {diff > 0 && <span className="text-red-600 text-[10px] ml-1">(-{diff.toFixed(2)})</span>}
                                </td>
                              )}
                              <td className="py-2.5 px-3 text-right text-gray-700">{formatCurrency(it.precio_unitario)}</td>
                              <td className="py-2.5 px-3 text-right font-medium text-gray-900">{formatCurrency(it.subtotal)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Totales */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium">{formatCurrency(detailCompra.subtotal ?? 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    IGV (18%)
                    {!(editMode ? editForm.incluir_igv : detailCompra.incluir_igv) && (
                      <span className="text-amber-600 text-xs ml-1">· desactivado</span>
                    )}
                  </span>
                  <span className="font-medium">
                    {formatCurrency(
                      editMode
                        ? (editForm.incluir_igv ? Number(detailCompra.subtotal ?? 0) * IGV_RATE : 0)
                        : (detailCompra.igv ?? 0)
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2 mt-1">
                  <span>Total</span>
                  <span className="text-green-600">
                    {formatCurrency(
                      editMode
                        ? Number(detailCompra.subtotal ?? 0) + (editForm.incluir_igv ? Number(detailCompra.subtotal ?? 0) * IGV_RATE : 0)
                        : (detailCompra.total ?? 0)
                    )}
                  </span>
                </div>
              </div>

              {/* Acciones según estado */}
              <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-gray-100">
                {editMode ? (
                  <>
                    <Button variant="outline" onClick={() => setEditMode(false)} disabled={editSaving}>Cancelar</Button>
                    <Button onClick={guardarEdicionCabecera} disabled={editSaving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                      {editSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                      Guardar Cambios
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>

                    {/* Anular: disponible en registrada y recibida */}
                    {(detailCompra.estado === 'registrada' || detailCompra.estado === 'recibida') && (
                      <Button variant="outline" onClick={anularCompra} disabled={transicionando}
                        className="text-red-600 border-red-200 hover:bg-red-50 gap-1">
                        Anular
                      </Button>
                    )}

                    {/* Editar cabecera: en registrada y recibida */}
                    {(detailCompra.estado === 'registrada' || detailCompra.estado === 'recibida') && (
                      <Button variant="outline" onClick={() => setEditMode(true)}>
                        Editar cabecera
                      </Button>
                    )}

                    {/* Validar recepción: solo en registrada */}
                    {detailCompra.estado === 'registrada' && (
                      <Button onClick={abrirValidacion} disabled={transicionando}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-1">
                        Validar recepción →
                      </Button>
                    )}

                    {/* Aplicar al almacén: solo en recibida */}
                    {detailCompra.estado === 'recibida' && (
                      <>
                        <Button variant="outline" onClick={volverARegistrada} disabled={transicionando}>
                          ← Volver a registrada
                        </Button>
                        <Button onClick={aplicarCompra} disabled={transicionando}
                          className="bg-green-600 hover:bg-green-700 text-white font-semibold gap-1">
                          {transicionando && <Loader2 className="w-4 h-4 animate-spin" />}
                          Aplicar al almacén ✓
                        </Button>
                      </>
                    )}

                    {/* Revertir: solo en aplicada */}
                    {detailCompra.estado === 'aplicada' && (
                      <Button onClick={revertirCompra} disabled={transicionando}
                        className="bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-1">
                        {transicionando && <Loader2 className="w-4 h-4 animate-spin" />}
                        Revertir aplicación
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog Validar Recepción */}
      <Dialog open={validarOpen} onOpenChange={setValidarOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package2 className="w-5 h-5 text-blue-600" />
              Validar recepción de mercadería
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800">
              Ingresa la cantidad realmente recibida por cada producto. Si recibiste menos
              de lo facturado, al aplicar la compra se generará automáticamente una
              <strong> nota de crédito contable</strong> por la diferencia.
            </div>

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Producto</th>
                    <th className="text-right py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase">Facturado</th>
                    <th className="text-right py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase">Recibido</th>
                    <th className="text-right py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Diferencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {itemsRecepcion.map((it, idx) => {
                    const diff = it.cantidad - it.cantidad_recibida
                    return (
                      <tr key={it.id}>
                        <td className="py-2 px-3 text-sm text-gray-900 max-w-[280px] truncate">{it.producto}</td>
                        <td className="py-2 px-2 text-right text-gray-700 font-mono">{it.cantidad}</td>
                        <td className="py-2 px-2">
                          <Input
                            type="number"
                            min={0}
                            max={it.cantidad}
                            step="0.01"
                            value={it.cantidad_recibida}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(it.cantidad, parseFloat(e.target.value) || 0))
                              setItemsRecepcion((prev) => prev.map((r, i) => i === idx ? { ...r, cantidad_recibida: v } : r))
                            }}
                            className="h-8 text-right font-mono w-24 ml-auto"
                          />
                        </td>
                        <td className={`py-2 px-3 text-right font-mono text-sm ${diff > 0 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                          {diff > 0 ? `-${diff} (NC: ${formatCurrency(diff * it.precio_unitario)})` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Resumen de NC potencial */}
            {(() => {
              const totalNC = itemsRecepcion.reduce((acc, it) => acc + Math.max(0, it.cantidad - it.cantidad_recibida) * it.precio_unitario, 0)
              if (totalNC > 0) {
                return (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900">
                    <strong>Nota de crédito esperada:</strong> {formatCurrency(totalNC)} (subtotal sin IGV).
                    Se generará automáticamente al aplicar la compra.
                  </div>
                )
              }
              return null
            })()}

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <Button variant="outline" onClick={() => setValidarOpen(false)} disabled={validarSaving}>Cancelar</Button>
              <Button onClick={confirmarRecepcion} disabled={validarSaving}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-2">
                {validarSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar recepción
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Portal del dropdown de productos: posicionado fixed al input para evitar clipping por contenedores con overflow */}
      {showProductoDropdownIdx !== null && dropdownPos && typeof window !== 'undefined' && createPortal(
        (() => {
          const idx = showProductoDropdownIdx
          const q = (productoSearchByIdx[idx] ?? '').toLowerCase().trim()
          const lista = q.length >= 1
            ? productos.filter((p: any) =>
                ((p as any).descripcion ?? '').toLowerCase().includes(q) ||
                (p.nombre ?? '').toLowerCase().includes(q) ||
                ((p as any).codigo ?? '').toLowerCase().includes(q)
              )
            : productos
          if (lista.length === 0) return null
          return (
            <div
              style={{
                position: 'fixed',
                top: dropdownPos.top,
                left: dropdownPos.left,
                width: dropdownPos.width,
                zIndex: 100,
              }}
              className="bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden max-h-72 overflow-y-auto"
            >
              {lista.slice(0, 50).map((p: any) => {
                const stockN = Number(p.stock_cantidad ?? 0)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setValue(`items.${idx}.producto_id`, p.id)
                      setProductoSearchByIdx((prev) => ({ ...prev, [idx]: p.descripcion?.trim() || p.nombre }))
                      setShowProductoDropdownIdx(null)
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-green-50 border-b border-gray-100 last:border-0 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-gray-900 truncate">
                        {p.descripcion?.trim() || p.nombre}
                        {(p.tiene_lote || p.tiene_vencimiento) && (
                          <span className="ml-1 text-[10px] text-amber-600">· lote</span>
                        )}
                      </div>
                      {p.codigo && <div className="text-[10px] text-gray-400 font-mono">{p.codigo}</div>}
                    </div>
                    <div className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      stockN === 0 ? 'bg-gray-100 text-gray-500' :
                      stockN <= 10 ? 'bg-red-50 text-red-700 border border-red-200' :
                      'bg-green-50 text-green-700 border border-green-200'
                    }`}>
                      Stock: {stockN} {p.um}
                    </div>
                  </button>
                )
              })}
              {lista.length > 50 && (
                <div className="px-3 py-1.5 text-[10px] text-gray-400 text-center bg-gray-50">
                  Mostrando 50 de {lista.length}. Refina la búsqueda.
                </div>
              )}
            </div>
          )
        })(),
        document.body
      )}
    </div>
  )
}
