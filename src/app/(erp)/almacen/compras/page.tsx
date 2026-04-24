'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Loader2, ShoppingCart, ChevronLeft, ChevronRight, X, Package2,
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

  const { register, handleSubmit, watch, setValue, control, reset, formState: { errors } } = useForm<CompraFormData>({
    resolver: zodResolver(compraSchema) as any,
    defaultValues: {
      tipo: 'directa',
      metodo_valorizacion: 'promedio',
      fecha: new Date().toISOString().split('T')[0],
      items: [{ producto_id: '', cantidad: 1, precio_unitario: 0, lote_numero: '', lote_fecha_fabricacion: '', lote_fecha_vencimiento: '' }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchItems = watch('items')

  const [incluirIgv, setIncluirIgv] = useState(true)
  const subtotal = watchItems?.reduce(
    (acc, item) => acc + (Number(item.cantidad) || 0) * (Number(item.precio_unitario) || 0),
    0
  ) ?? 0
  const igv = incluirIgv ? subtotal * IGV_RATE : 0
  const totalCompra = subtotal + igv

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: c, count }, { data: p }, { data: pr }] = await Promise.all([
      supabase
        .from('compras')
        .select(`id, numero_factura_proveedor, fecha, total, estado, proveedores(razon_social)`, { count: 'exact' })
        .order('fecha', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1),
      supabase.from('proveedores').select('id, razon_social').eq('activo', true).order('razon_social'),
      supabase.from('productos').select('id, codigo, nombre, tiene_lote, tiene_vencimiento').eq('activo', true).order('nombre'),
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
          description: `El producto "${prod.nombre}" requiere número de lote.`,
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
                    {['Factura', 'Proveedor', 'Fecha', 'Total', 'Estado'].map((h) => (
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
                  onClick={() => append({ producto_id: '', cantidad: 1, precio_unitario: 0, lote_numero: '', lote_fecha_fabricacion: '', lote_fecha_vencimiento: '' })}
                  className="h-7 gap-1 text-xs"
                >
                  <Plus className="w-3 h-3" /> Agregar
                </Button>
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
                                {productos.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.nombre}
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
                              {...register(`items.${idx}.cantidad`)}
                              type="number"
                              min={1}
                              step="0.01"
                              className="h-8 text-xs mt-1"
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-[10px] text-gray-500">P. Unit.</Label>
                            <Input
                              {...register(`items.${idx}.precio_unitario`)}
                              type="number"
                              min={0}
                              step="0.01"
                              className="h-8 text-xs mt-1"
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-[10px] text-gray-500">Subtotal</Label>
                            <p className="h-8 text-xs mt-1 font-medium text-gray-700 flex items-center">
                              {formatCurrency(cant * precio)}
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
    </div>
  )
}
