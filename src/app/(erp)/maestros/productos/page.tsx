'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Search, Edit, Loader2, ChevronLeft, ChevronRight, Package
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

const productoSchema = z.object({
  codigo: z.string().min(1, 'Requerido'),
  nombre: z.string().min(2, 'Mínimo 2 caracteres'),
  descripcion: z.string().nullable().optional(),
  familia_id: z.string().nullable().optional(),
  unidad_medida_id: z.string().nullable().optional(),
  tiene_lote: z.boolean().default(false),
  tiene_percepcion: z.boolean().default(false),
  activo: z.boolean().default(true),
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
  const [editingProducto, setEditingProducto] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [tieneLote, setTieneLote] = useState(false)
  const [tienePercepcion, setTienePercepcion] = useState(false)
  const [activo, setActivo] = useState(true)

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<ProductoFormData>({
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
        id, codigo, nombre, tiene_lote, tiene_percepcion, activo,
        familias(nombre),
        unidades_medida(nombre, simbolo),
        precios_lista_producto(precio, listas_precio(nombre))
      `, { count: 'exact' })
      .order('nombre')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (search) query = query.ilike('nombre', `%${search}%`)
    if (filterFamilia !== 'todas') query = query.eq('familia_id', filterFamilia)

    const { data, count } = await query
    setProductos(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search, filterFamilia])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { loadProductos() }, [loadProductos])

  const openCreate = () => {
    setEditingProducto(null)
    setTieneLote(false)
    setTienePercepcion(false)
    setActivo(true)
    reset({ tiene_lote: false, tiene_percepcion: false, activo: true })
    setDialogOpen(true)
  }

  const openEdit = (producto: any) => {
    setEditingProducto(producto)
    setTieneLote(producto.tiene_lote)
    setTienePercepcion(producto.tiene_percepcion)
    setActivo(producto.activo)
    reset({
      codigo: producto.codigo,
      nombre: producto.nombre,
      descripcion: producto.descripcion ?? '',
      familia_id: producto.familia_id ?? '',
      unidad_medida_id: producto.unidad_medida_id ?? '',
      tiene_lote: producto.tiene_lote,
      tiene_percepcion: producto.tiene_percepcion,
      activo: producto.activo,
    })
    setDialogOpen(true)
  }

  const onSubmit = async (data: ProductoFormData) => {
    setSaving(true)
    const payload = {
      codigo: data.codigo,
      nombre: data.nombre,
      tiene_lote: tieneLote,
      tiene_percepcion: tienePercepcion,
      activo,
      descripcion: data.descripcion || null,
      familia_id: data.familia_id || null,
      unidad_medida_id: data.unidad_medida_id || null,
      updated_at: new Date().toISOString(),
    }

    if (editingProducto) {
      await supabase.from('productos').update(payload).eq('id', editingProducto.id)
    } else {
      await supabase.from('productos').insert(payload)
    }

    setSaving(false)
    setDialogOpen(false)
    loadProductos()
  }

  const getPrecio = (producto: any, lista: string) => {
    const precio = producto.precios_lista_producto?.find(
      (p: any) => p.listas_precio?.nombre === lista
    )
    return precio ? formatCurrency(precio.precio) : '—'
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Productos</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} productos registrados</p>
        </div>
        <Button onClick={openCreate} className="bg-green-600 hover:bg-green-700 gap-2">
          <Plus className="w-4 h-4" /> Nuevo Producto
        </Button>
      </div>

      {/* Filtros */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
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
              <SelectTrigger className="w-44">
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

      {/* Tabla */}
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Código', 'Nombre', 'Familia', 'UM', 'Precio A', 'Precio B', 'Precio C', 'Lote', 'Percepc.', 'Estado'].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {productos.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="py-3 px-4 font-mono text-xs text-gray-500">{p.codigo}</td>
                      <td className="py-3 px-4 font-medium text-gray-900 max-w-[220px]">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{p.nombre}</span>
                          <button
                            onClick={() => openEdit(p)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Edit className="w-3.5 h-3.5 text-gray-400" />
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-600 text-xs">{p.familias?.nombre ?? '—'}</td>
                      <td className="py-3 px-4 text-gray-600 text-xs">{p.unidades_medida?.simbolo ?? '—'}</td>
                      <td className="py-3 px-4 text-gray-700 text-xs font-medium">{getPrecio(p, 'A')}</td>
                      <td className="py-3 px-4 text-gray-700 text-xs font-medium">{getPrecio(p, 'B')}</td>
                      <td className="py-3 px-4 text-gray-700 text-xs font-medium">{getPrecio(p, 'C')}</td>
                      <td className="py-3 px-4">
                        {p.tiene_lote
                          ? <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-200">Sí</Badge>
                          : <span className="text-gray-400 text-xs">No</span>
                        }
                      </td>
                      <td className="py-3 px-4">
                        {p.tiene_percepcion
                          ? <Badge className="text-xs bg-purple-100 text-purple-700 border-purple-200">Sí</Badge>
                          : <span className="text-gray-400 text-xs">No</span>
                        }
                      </td>
                      <td className="py-3 px-4">
                        {p.activo
                          ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                          : <Badge variant="secondary" className="text-xs">Inactivo</Badge>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
              </p>
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

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingProducto ? 'Editar Producto' : 'Nuevo Producto'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-4 mt-2">
            <div>
              <Label>Código *</Label>
              <Input {...register('codigo')} placeholder="PROD001" className="mt-1" />
              {errors.codigo && <p className="text-xs text-red-500 mt-1">{errors.codigo.message}</p>}
            </div>

            <div>
              <Label>Nombre *</Label>
              <Input {...register('nombre')} placeholder="Nombre del producto" className="mt-1" />
              {errors.nombre && <p className="text-xs text-red-500 mt-1">{errors.nombre.message}</p>}
            </div>

            <div>
              <Label>Descripción</Label>
              <Input {...register('descripcion')} placeholder="Descripción opcional" className="mt-1" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Familia</Label>
                <Select onValueChange={(v) => setValue('familia_id', v)}>
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
                <Select onValueChange={(v) => setValue('unidad_medida_id', v)}>
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

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={tieneLote} onCheckedChange={setTieneLote} />
                <Label>Manejo de Lote</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={tienePercepcion} onCheckedChange={setTienePercepcion} />
                <Label>Percepción</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={activo} onCheckedChange={setActivo} />
                <Label>Activo</Label>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-green-600 hover:bg-green-700 gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingProducto ? 'Guardar Cambios' : 'Crear Producto'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
