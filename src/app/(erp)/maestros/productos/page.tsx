'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Search, Edit, Eye, Loader2, ChevronLeft, ChevronRight,
  Package, ToggleLeft, ToggleRight, Tag, Hash,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const productoSchema = z.object({
  codigo: z.string().min(1, 'Requerido'),
  nombre: z.string().min(2, 'Mínimo 2 caracteres'),
  descripcion: z.string().nullable().optional(),
  familia_id: z.string().nullable().optional(),
  unidad_medida_id: z.string().nullable().optional(),
  tasa_percepcion: z.coerce.number().min(0).max(100).nullable().optional(),
})

type ProductoFormData = z.infer<typeof productoSchema>

const PAGE_SIZE = 15

export default function ProductosPage() {
  const supabase = createClient()

  const [productos, setProductos] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterFamilia, setFilterFamilia] = useState('todas')
  const [familias, setFamilias] = useState<any[]>([])
  const [unidades, setUnidades] = useState<any[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [editingProducto, setEditingProducto] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [tieneLote, setTieneLote] = useState(false)
  const [tieneVencimiento, setTieneVencimiento] = useState(false)
  const [tienePercepcion, setTienePercepcion] = useState(false)
  const [activo, setActivo] = useState(true)
  const [familiaId, setFamiliaId] = useState<string>('')
  const [unidadMedidaId, setUnidadMedidaId] = useState<string>('')

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProductoFormData>({
    resolver: zodResolver(productoSchema) as any,
  })

  const loadMeta = useCallback(async () => {
    const [{ data: f }, { data: u }] = await Promise.all([
      supabase.from('familias').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('unidades_medida').select('id, nombre, simbolo').eq('activo', true),
    ])
    setFamilias(f ?? [])
    setUnidades(u ?? [])
  }, [])

  const loadProductos = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('productos')
      .select(`
        id, codigo, nombre, descripcion, familia_id, unidad_medida_id,
        tiene_lote, tiene_vencimiento, tiene_percepcion, tasa_percepcion, activo, created_at,
        familias(id, nombre),
        unidades_medida(id, nombre, simbolo),
        lista_precio_items(precio, listas_precio(nombre))
      `, { count: 'exact' })
      .order('nombre')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (search) query = query.ilike('nombre', `%${search}%`)
    if (filterFamilia !== 'todas') query = query.eq('familia_id', filterFamilia)

    const { data, count, error } = await query
    if (error) toast.error('Error al cargar productos', { description: error.message })
    setProductos(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search, filterFamilia])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { loadProductos() }, [loadProductos])

  const openCreate = () => {
    setEditingProducto(null)
    setTieneLote(false)
    setTieneVencimiento(false)
    setTienePercepcion(false)
    setActivo(true)
    setFamiliaId('')
    setUnidadMedidaId('')
    reset({ codigo: '', nombre: '', descripcion: '', familia_id: '', unidad_medida_id: '', tasa_percepcion: 0 })
    setDialogOpen(true)
  }

  const openEdit = (producto: any) => {
    setEditingProducto(producto)
    setTieneLote(!!producto.tiene_lote)
    setTieneVencimiento(!!producto.tiene_vencimiento)
    setTienePercepcion(!!producto.tiene_percepcion)
    setActivo(!!producto.activo)
    setFamiliaId(producto.familia_id ?? '')
    setUnidadMedidaId(producto.unidad_medida_id ?? '')
    reset({
      codigo: producto.codigo,
      nombre: producto.nombre,
      descripcion: producto.descripcion ?? '',
      familia_id: producto.familia_id ?? '',
      unidad_medida_id: producto.unidad_medida_id ?? '',
      tasa_percepcion: producto.tasa_percepcion ?? 0,
    })
    setDialogOpen(true)
  }

  const openDetail = (p: any) => { setSelected(p); setDetailOpen(true) }

  const onSubmit = async (data: ProductoFormData) => {
    setSaving(true)
    try {
      const payload = {
        codigo: data.codigo,
        nombre: data.nombre,
        descripcion: data.descripcion || null,
        familia_id: familiaId || null,
        unidad_medida_id: unidadMedidaId || null,
        tiene_lote: tieneLote,
        tiene_vencimiento: tieneVencimiento,
        tiene_percepcion: tienePercepcion,
        tasa_percepcion: tienePercepcion ? (data.tasa_percepcion ?? 0) : 0,
        activo,
        updated_at: new Date().toISOString(),
      }

      if (editingProducto) {
        const { error } = await (supabase.from('productos') as any)
          .update(payload)
          .eq('id', editingProducto.id)
        if (error) throw error
        toast.success('Producto actualizado', { description: `${data.nombre} se guardó correctamente.` })
      } else {
        const { error } = await (supabase.from('productos') as any).insert(payload)
        if (error) throw error
        toast.success('Producto creado', { description: `${data.nombre} se registró correctamente.` })
      }

      setDialogOpen(false)
      loadProductos()
    } catch (err: any) {
      toast.error('No se pudo guardar', { description: err?.message ?? 'Intenta nuevamente.' })
    } finally {
      setSaving(false)
    }
  }

  const toggleActivo = async (p: any) => {
    const { error } = await supabase.from('productos').update({ activo: !p.activo }).eq('id', p.id)
    if (error) {
      toast.error('No se pudo cambiar el estado', { description: error.message })
    } else {
      toast.success(p.activo ? 'Producto desactivado' : 'Producto activado')
      loadProductos()
    }
  }

  const getPrecio = (producto: any, lista: string) => {
    const precio = producto.lista_precio_items?.find(
      (pi: any) => pi.listas_precio?.nombre === lista
    )
    return precio ? formatCurrency(precio.precio) : '—'
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Productos</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} productos registrados</p>
        </div>
        <Button onClick={openCreate} className="bg-green-600 hover:bg-green-700 gap-2 w-full sm:w-auto">
          <Plus className="w-4 h-4" /> Nuevo Producto
        </Button>
      </div>

      {/* Filtros */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Buscar por nombre..."
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              />
            </div>
            <Select value={filterFamilia} onValueChange={(v) => { setFilterFamilia(v); setPage(0) }}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="Familia" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las familias</SelectItem>
                {familias.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Listado */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : productos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Package className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No se encontraron productos</p>
            </div>
          ) : (
            <>
              {/* Vista móvil: cards */}
              <div className="md:hidden divide-y divide-gray-50">
                {productos.map((p) => (
                  <div key={p.id} className="p-4 hover:bg-gray-50/50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate">{p.nombre}</p>
                        <p className="text-xs text-gray-500 font-mono">{p.codigo}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {p.familias?.nombre ?? 'Sin familia'} · {p.unidades_medida?.simbolo ?? '—'}
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-xs">
                          <span className="text-gray-600">A: <span className="font-medium">{getPrecio(p, 'A')}</span></span>
                          <span className="text-gray-600">B: <span className="font-medium">{getPrecio(p, 'B')}</span></span>
                          <span className="text-gray-600">C: <span className="font-medium">{getPrecio(p, 'C')}</span></span>
                        </div>
                      </div>
                      {p.activo
                        ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200 shrink-0">Activo</Badge>
                        : <Badge variant="secondary" className="text-xs shrink-0">Inactivo</Badge>}
                    </div>
                    <div className="flex items-center gap-1 mt-3">
                      <Button variant="outline" size="sm" onClick={() => openDetail(p)} className="h-7 text-xs gap-1">
                        <Eye className="w-3.5 h-3.5" /> Ver
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(p)} className="h-7 text-xs gap-1">
                        <Edit className="w-3.5 h-3.5" /> Editar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => toggleActivo(p)} className="h-7 text-xs gap-1">
                        {p.activo ? <ToggleRight className="w-3.5 h-3.5 text-green-600" /> : <ToggleLeft className="w-3.5 h-3.5 text-gray-400" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Vista desktop: tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {['Código', 'Nombre', 'Familia', 'UM', 'Precio A', 'Precio B', 'Precio C', 'Estado', 'Acciones'].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {productos.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs text-gray-500">{p.codigo}</td>
                        <td className="py-3 px-4 font-medium text-gray-900 max-w-[220px] truncate">{p.nombre}</td>
                        <td className="py-3 px-4 text-gray-600 text-xs">{p.familias?.nombre ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-600 text-xs">{p.unidades_medida?.simbolo ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-700 text-xs font-medium">{getPrecio(p, 'A')}</td>
                        <td className="py-3 px-4 text-gray-700 text-xs font-medium">{getPrecio(p, 'B')}</td>
                        <td className="py-3 px-4 text-gray-700 text-xs font-medium">{getPrecio(p, 'C')}</td>
                        <td className="py-3 px-4">
                          {p.activo
                            ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                            : <Badge variant="secondary" className="text-xs">Inactivo</Badge>}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openDetail(p)} className="h-7 w-7 p-0" title="Ver detalle">
                              <Eye className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openEdit(p)} className="h-7 w-7 p-0" title="Editar">
                              <Edit className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => toggleActivo(p)} className="h-7 w-7 p-0" title={p.activo ? 'Desactivar' : 'Activar'}>
                              {p.activo ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">{total} productos</p>
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

      {/* Dialog Crear/Editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProducto ? 'Editar Producto' : 'Nuevo Producto'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Código *</Label>
                <Input {...register('codigo')} placeholder="PROD001" className="mt-1 font-mono" />
                {errors.codigo && <p className="text-xs text-red-500 mt-1">{errors.codigo.message}</p>}
              </div>
              <div>
                <Label>Nombre *</Label>
                <Input {...register('nombre')} placeholder="Nombre del producto" className="mt-1" />
                {errors.nombre && <p className="text-xs text-red-500 mt-1">{errors.nombre.message}</p>}
              </div>
            </div>

            <div>
              <Label>Descripción</Label>
              <Textarea {...register('descripcion')} placeholder="Descripción opcional" className="mt-1" rows={2} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Familia</Label>
                <Select value={familiaId} onValueChange={setFamiliaId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {familias.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Unidad de Medida</Label>
                <Select value={unidadMedidaId} onValueChange={setUnidadMedidaId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {unidades.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.nombre} ({u.simbolo})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <Switch checked={tieneLote} onCheckedChange={setTieneLote} />
                <Label>Manejo de Lote</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={tieneVencimiento} onCheckedChange={setTieneVencimiento} />
                <Label>Manejo de Vencimiento</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={tienePercepcion} onCheckedChange={setTienePercepcion} />
                <Label>Aplica Percepción</Label>
              </div>
              {tienePercepcion && (
                <div>
                  <Label>Tasa de Percepción (%)</Label>
                  <Input
                    {...register('tasa_percepcion')}
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="2.00"
                    className="mt-1"
                  />
                </div>
              )}
              <div className="flex items-center gap-2">
                <Switch checked={activo} onCheckedChange={setActivo} />
                <Label>Activo</Label>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-green-600 hover:bg-green-700 gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingProducto ? 'Guardar Cambios' : 'Crear Producto'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Detalle */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Producto</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
                <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center shrink-0">
                  <Package className="w-6 h-6 text-green-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 truncate">{selected.nombre}</p>
                  <p className="text-xs text-gray-500 font-mono">{selected.codigo}</p>
                </div>
                {selected.activo
                  ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                  : <Badge variant="secondary" className="text-xs">Inactivo</Badge>}
              </div>

              {selected.descripcion && (
                <div>
                  <p className="text-xs text-gray-500">Descripción</p>
                  <p className="text-sm text-gray-800">{selected.descripcion}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-start gap-2">
                  <Tag className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-500">Familia</p>
                    <p className="text-gray-800">{selected.familias?.nombre ?? '—'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Hash className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-500">Unidad</p>
                    <p className="text-gray-800">{selected.unidades_medida?.nombre ?? '—'}</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wide">Precios</p>
                <div className="grid grid-cols-3 gap-2">
                  {['A', 'B', 'C'].map((l) => (
                    <div key={l} className="bg-gray-50 rounded-lg p-2 text-center">
                      <p className="text-xs text-gray-500">Lista {l}</p>
                      <p className="text-sm font-semibold text-gray-900">{getPrecio(selected, l)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wide">Características</p>
                <div className="flex flex-wrap gap-2">
                  {selected.tiene_lote && <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-200">Maneja Lote</Badge>}
                  {selected.tiene_vencimiento && <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200">Vencimiento</Badge>}
                  {selected.tiene_percepcion && (
                    <Badge className="text-xs bg-purple-100 text-purple-700 border-purple-200">
                      Percepción {selected.tasa_percepcion ? `${selected.tasa_percepcion}%` : ''}
                    </Badge>
                  )}
                  {!selected.tiene_lote && !selected.tiene_vencimiento && !selected.tiene_percepcion && (
                    <span className="text-xs text-gray-400">Sin características especiales</span>
                  )}
                </div>
              </div>

              {selected.created_at && (
                <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
                  Registrado el {formatDate(selected.created_at)}
                </p>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-3 border-t border-gray-100">
                <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>
                <Button onClick={() => { setDetailOpen(false); openEdit(selected) }} className="bg-green-600 hover:bg-green-700 gap-2">
                  <Edit className="w-4 h-4" /> Editar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
