'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Loader2, ShoppingCart, ChevronLeft, ChevronRight, X, Package2, Eye, Calendar, FileText, Building2, Receipt,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
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

const ESTADO_CONFIG: Record<string, { label: string; className: string }> = {
  activo: { label: 'Activo', className: 'bg-green-100 text-green-700' },
  anulado: { label: 'Anulado', className: 'bg-red-100 text-red-700' },
}

type ProductoCatalogo = {
  id: string
  codigo: string
  nombre: string
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

  const { register, handleSubmit, watch, setValue, control, reset, formState: { errors } } = useForm<CompraFormData>({
    resolver: zodResolver(compraSchema) as any,
    defaultValues: {
      tipo: 'directa',
      metodo_valorizacion: 'promedio',
      fecha: new Date().toISOString().split('T')[0],
      items: [{ producto_id: '', cantidad: 1, precio_unitario: 0, total_linea: 0, lote_numero: '', lote_fecha_fabricacion: '', lote_fecha_vencimiento: '' }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchItems = watch('items')

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

  const subtotal = watchItems?.reduce(
    (acc, item) => acc + (Number(item.cantidad) || 0) * (Number(item.precio_unitario) || 0),
    0
  ) ?? 0
  const igv = incluirIgv ? subtotal * IGV_RATE : 0
  const totalCompra = subtotal + igv

  // Helpers de cálculo entre modos
  const calcPUnitDesdeTotal = (totalLinea: number, cantidad: number, igvIncluido: boolean) => {
    if (cantidad <= 0) return 0
    const divisor = igvIncluido ? 1 + IGV_RATE : 1
    return totalLinea / cantidad / divisor
  }
  const calcTotalLineaDesdePUnit = (pUnit: number, cantidad: number, igvIncluido: boolean) => {
    const mult = igvIncluido ? 1 + IGV_RATE : 1
    return pUnit * cantidad * mult
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
      supabase.from('proveedores').select('id, razon_social').eq('activo', true).order('razon_social'),
      supabase.from('productos').select('id, codigo, nombre, descripcion, tiene_lote, tiene_vencimiento').eq('activo', true).order('nombre'),
    ])
    setCompras(c ?? [])
    setTotal(count ?? 0)
    setProveedores(p ?? [])
    setProductos((pr ?? []) as ProductoCatalogo[])
    setLoading(false)
  }, [page])

  useEffect(() => { loadData() }, [loadData])

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

    const subtotalCalc = data.items.reduce(
      (acc, item) => acc + item.cantidad * item.precio_unitario, 0
    )
    const igvCalc = incluirIgv ? subtotalCalc * IGV_RATE : 0

    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData?.user?.id ?? null

      // 1. Insertar cabecera en compras
      const { data: compra, error } = await (supabase.from('compras') as any).insert({
        proveedor_id: data.proveedor_id,
        numero_factura_proveedor: data.numero_factura,
        fecha: data.fecha,
        metodo_valorizacion: data.metodo_valorizacion,
        subtotal: subtotalCalc,
        igv: igvCalc,
        incluir_igv: incluirIgv,
        total: subtotalCalc + igvCalc,
        moneda: 'PEN',
        estado: 'activo',
        created_by: userId,
      }).select().single()

      if (error || !compra) {
        throw new Error(error?.message ?? 'No se pudo crear la compra.')
      }

      // 2. Por cada item: si tiene lote/vencimiento, crear lote y obtener lote_id
      const itemsToInsert: any[] = []
      for (const item of data.items) {
        const prod = productos.find((p) => p.id === item.producto_id)
        let loteId: string | null = null

        if (prod && (prod.tiene_lote || prod.tiene_vencimiento) && item.lote_numero?.trim()) {
          const { data: lote, error: loteError } = await (supabase.from('lotes') as any).insert({
            producto_id: item.producto_id,
            numero_lote: item.lote_numero.trim(),
            fecha_vencimiento: item.lote_fecha_vencimiento || null,
            cantidad_inicial: item.cantidad,
            cantidad_actual: item.cantidad,
            activo: true,
          }).select('id').single()

          if (loteError) {
            // Si el lote ya existe (unique constraint), intentar obtenerlo
            const { data: existing } = await supabase
              .from('lotes')
              .select('id, cantidad_actual')
              .eq('producto_id', item.producto_id)
              .eq('numero_lote', item.lote_numero.trim())
              .maybeSingle()
            if (existing) {
              loteId = (existing as any).id
              // actualizar cantidad_actual
              await (supabase.from('lotes') as any)
                .update({ cantidad_actual: Number((existing as any).cantidad_actual ?? 0) + item.cantidad })
                .eq('id', loteId)
            } else {
              throw new Error(`No se pudo registrar el lote: ${loteError.message}`)
            }
          } else {
            loteId = lote?.id ?? null
          }
        }

        itemsToInsert.push({
          compra_id: compra.id,
          producto_id: item.producto_id,
          lote_id: loteId,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
          subtotal: item.cantidad * item.precio_unitario,
        })
      }

      const { error: itemsError } = await (supabase.from('compras_items') as any).insert(itemsToInsert)
      if (itemsError) throw new Error(itemsError.message)

      toast.success('Compra registrada', {
        description: `Factura ${data.numero_factura} · Total ${formatCurrency(subtotalCalc + igvCalc)}`,
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
      const subtotalActual = Number(detailCompra.subtotal ?? 0)
      const igvNuevo = editForm.incluir_igv ? subtotalActual * IGV_RATE : 0
      const totalNuevo = subtotalActual + igvNuevo

      const { error } = await (supabase.from('compras') as any)
        .update({
          proveedor_id: editForm.proveedor_id,
          numero_factura_proveedor: editForm.numero_factura.trim(),
          fecha: editForm.fecha,
          metodo_valorizacion: editForm.metodo_valorizacion,
          incluir_igv: editForm.incluir_igv,
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
                <Select onValueChange={(v) => setValue('proveedor_id', v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar proveedor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {proveedores.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.razon_social}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  onClick={() => append({ producto_id: '', cantidad: 1, precio_unitario: 0, total_linea: 0, lote_numero: '', lote_fecha_fabricacion: '', lote_fecha_vencimiento: '' })}
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
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="divide-y divide-gray-100">
                  {fields.map((field, idx) => {
                    const cant = Number(watchItems?.[idx]?.cantidad) || 0
                    const precio = Number(watchItems?.[idx]?.precio_unitario) || 0
                    const productoId = watchItems?.[idx]?.producto_id
                    const prod = productos.find((p) => p.id === productoId)
                    const requiereLote = prod?.tiene_lote || prod?.tiene_vencimiento
                    return (
                      <div key={field.id} className="p-3 bg-white">
                        <div className="grid grid-cols-12 gap-2 items-start">
                          <div className="col-span-5">
                            <Label className="text-[10px] text-gray-500">Producto</Label>
                            <Select onValueChange={(v) => setValue(`items.${idx}.producto_id`, v)}>
                              <SelectTrigger className="h-8 text-xs mt-1">
                                <SelectValue placeholder="Seleccionar..." />
                              </SelectTrigger>
                              <SelectContent>
                                {productos.map((p: any) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.descripcion?.trim() || p.nombre}
                                    {(p.tiene_lote || p.tiene_vencimiento) && (
                                      <span className="ml-1 text-[10px] text-amber-600">· lote</span>
                                    )}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-2">
                            <Label className="text-[10px] text-gray-500">Cantidad</Label>
                            <Input
                              type="number"
                              min={1}
                              step="0.01"
                              value={watchItems?.[idx]?.cantidad ?? ''}
                              onChange={(e) => {
                                const nuevaCant = parseFloat(e.target.value) || 0
                                setValue(`items.${idx}.cantidad`, nuevaCant)
                                if (modoIngreso === 'total') {
                                  const tot = Number(watchItems?.[idx]?.total_linea ?? 0)
                                  if (tot > 0) {
                                    setValue(`items.${idx}.precio_unitario`, calcPUnitDesdeTotal(tot, nuevaCant, incluirIgv))
                                  }
                                }
                              }}
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
                                value={watchItems?.[idx]?.precio_unitario ?? ''}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value) || 0
                                  setValue(`items.${idx}.precio_unitario`, v)
                                  setValue(`items.${idx}.total_linea`, calcTotalLineaDesdePUnit(v, cant, incluirIgv))
                                }}
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
                                value={watchItems?.[idx]?.total_linea ?? ''}
                                onChange={(e) => {
                                  const tot = parseFloat(e.target.value) || 0
                                  setValue(`items.${idx}.total_linea`, tot)
                                  setValue(`items.${idx}.precio_unitario`, calcPUnitDesdeTotal(tot, cant, incluirIgv))
                                }}
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
                <Label className="text-xs font-semibold text-gray-700">Productos ({detailItems.length})</Label>
                <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Producto</th>
                        <th className="text-right py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Cant.</th>
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
                        return (
                          <tr key={it.id}>
                            <td className="py-2.5 px-3">
                              <p className="font-medium text-gray-900">{nombreProd}</p>
                              {lote && (
                                <p className="text-[11px] text-amber-700 mt-0.5">
                                  Lote {lote.numero_lote}
                                  {lote.fecha_vencimiento && ` · vence ${formatDate(lote.fecha_vencimiento)}`}
                                </p>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-700">{Number(it.cantidad).toFixed(2)} {um}</td>
                            <td className="py-2.5 px-3 text-right text-gray-700">{formatCurrency(it.precio_unitario)}</td>
                            <td className="py-2.5 px-3 text-right font-medium text-gray-900">{formatCurrency(it.subtotal)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
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

              {/* Acciones */}
              <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
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
                    {detailCompra.estado !== 'anulado' && (
                      <Button onClick={() => setEditMode(true)} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                        Editar cabecera
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
