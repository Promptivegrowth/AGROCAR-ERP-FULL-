'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Trash2, Loader2, ShoppingCart, ChevronLeft, ChevronRight, X
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

const itemSchema = z.object({
  producto_id: z.string().min(1, 'Seleccione producto'),
  cantidad: z.coerce.number().positive('Debe ser mayor a 0'),
  precio_unitario: z.coerce.number().positive('Debe ser mayor a 0'),
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
  borrador: { label: 'Borrador', className: 'bg-gray-100 text-gray-600' },
  enviado: { label: 'Enviado', className: 'bg-blue-100 text-blue-700' },
  recibido: { label: 'Recibido', className: 'bg-green-100 text-green-700' },
  cancelado: { label: 'Cancelado', className: 'bg-red-100 text-red-700' },
}

export default function ComprasPage() {
  const supabase = createClient()

  const [compras, setCompras] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [proveedores, setProveedores] = useState<any[]>([])
  const [productos, setProductos] = useState<any[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const { register, handleSubmit, watch, setValue, control, reset, formState: { errors } } = useForm<CompraFormData>({
    resolver: zodResolver(compraSchema) as any,
    defaultValues: {
      tipo: 'directa',
      metodo_valorizacion: 'promedio',
      fecha: new Date().toISOString().split('T')[0],
      items: [{ producto_id: '', cantidad: 1, precio_unitario: 0 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchItems = watch('items')

  const subtotal = watchItems?.reduce(
    (acc, item) => acc + (Number(item.cantidad) || 0) * (Number(item.precio_unitario) || 0),
    0
  ) ?? 0
  const igv = subtotal * IGV_RATE
  const totalCompra = subtotal + igv

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: c, count }, { data: p }, { data: pr }] = await Promise.all([
      supabase
        .from('ordenes_compra')
        .select(`id, numero, fecha, total, estado, proveedores(razon_social)`, { count: 'exact' })
        .order('fecha', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1),
      supabase.from('proveedores').select('id, razon_social').eq('activo', true).order('razon_social'),
      supabase.from('productos').select('id, codigo, nombre').eq('activo', true).order('nombre'),
    ])
    setCompras(c ?? [])
    setTotal(count ?? 0)
    setProveedores(p ?? [])
    setProductos(pr ?? [])
    setLoading(false)
  }, [page])

  useEffect(() => { loadData() }, [loadData])

  const onSubmit = async (data: CompraFormData) => {
    setSaving(true)

    const subtotalCalc = data.items.reduce(
      (acc, item) => acc + item.cantidad * item.precio_unitario, 0
    )
    const igvCalc = subtotalCalc * IGV_RATE

    // Insertar en ordenes_compra usando los campos correctos del schema
    const { data: oc, error } = await supabase.from('ordenes_compra').insert({
      numero: `OC-${Date.now()}`,
      proveedor_id: data.proveedor_id,
      fecha: data.fecha,
      subtotal: subtotalCalc,
      igv: igvCalc,
      total: subtotalCalc + igvCalc,
      estado: 'recibido' as const,
      notas: data.numero_factura ? `Factura proveedor: ${data.numero_factura}` : null,
    }).select().single()

    if (error || !oc) {
      setSaving(false)
      toast.error('Error al registrar compra', { description: error?.message ?? 'No se pudo crear la orden.' })
      return
    }

    const items = data.items.map((item) => ({
      orden_compra_id: oc.id,
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      subtotal: item.cantidad * item.precio_unitario,
    }))
    const { error: itemsError } = await supabase.from('ordenes_compra_items').insert(items)

    setSaving(false)
    setDialogOpen(false)
    reset()

    if (itemsError) {
      toast.error('Compra guardada con advertencias', { description: itemsError.message })
    } else {
      toast.success('Compra registrada', {
        description: `${oc.numero} · Total ${formatCurrency(subtotalCalc + igvCalc)}`,
      })
    }

    loadData()
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compras</h1>
          <p className="text-sm text-gray-500 mt-0.5">Registro de órdenes de compra y facturas de proveedores</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="bg-green-600 hover:bg-green-700 gap-2">
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
                    {['N° Orden', 'Proveedor', 'Fecha', 'Total', 'Estado'].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {compras.map((c) => {
                    const estadoCfg = ESTADO_CONFIG[c.estado] ?? ESTADO_CONFIG.borrador
                    return (
                      <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs text-gray-600">{c.numero ?? '—'}</td>
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
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
                  onClick={() => append({ producto_id: '', cantidad: 1, precio_unitario: 0 })}
                  className="h-7 gap-1 text-xs"
                >
                  <Plus className="w-3 h-3" /> Agregar
                </Button>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Producto</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 w-28">Cantidad</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 w-28">P. Unit.</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 w-28">Subtotal</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {fields.map((field, idx) => {
                      const cant = Number(watchItems?.[idx]?.cantidad) || 0
                      const precio = Number(watchItems?.[idx]?.precio_unitario) || 0
                      return (
                        <tr key={field.id}>
                          <td className="py-2 px-3">
                            <Select onValueChange={(v) => setValue(`items.${idx}.producto_id`, v)}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Seleccionar..." />
                              </SelectTrigger>
                              <SelectContent>
                                {productos.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              {...register(`items.${idx}.cantidad`)}
                              type="number"
                              min={1}
                              step="0.01"
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              {...register(`items.${idx}.precio_unitario`)}
                              type="number"
                              min={0}
                              step="0.01"
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="py-2 px-3 text-xs font-medium text-gray-700">
                            {formatCurrency(cant * precio)}
                          </td>
                          <td className="py-2 px-3">
                            {fields.length > 1 && (
                              <button type="button" onClick={() => remove(idx)} className="text-red-400 hover:text-red-600">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {errors.items && <p className="text-xs text-red-500 mt-1">{errors.items.message}</p>}
            </div>

            {/* Totales */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal (sin IGV)</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">IGV (18%)</span>
                <span className="font-medium">{formatCurrency(igv)}</span>
              </div>
              <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2 mt-2">
                <span>Total</span>
                <span className="text-green-600">{formatCurrency(totalCompra)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-green-600 hover:bg-green-700 gap-2">
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
