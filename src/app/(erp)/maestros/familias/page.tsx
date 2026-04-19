'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Search, Edit, ToggleLeft, ToggleRight, Loader2,
  ChevronLeft, ChevronRight, Tags, Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'

const familiaSchema = z.object({
  nombre: z.string().min(2, 'Mínimo 2 caracteres'),
  descripcion: z.string().nullable().optional(),
  activo: z.boolean().default(true),
})

type FamiliaFormData = z.infer<typeof familiaSchema>

const PAGE_SIZE = 15

export default function FamiliasPage() {
  const supabase = createClient()

  const [familias, setFamilias] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [editingFamilia, setEditingFamilia] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [activo, setActivo] = useState(true)

  // Conteo de productos por familia
  const [productosPorFamilia, setProductosPorFamilia] = useState<Record<string, number>>({})

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FamiliaFormData>({
    resolver: zodResolver(familiaSchema) as any,
  })

  const loadFamilias = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('familias')
      .select('id, nombre, descripcion, activo, created_at', { count: 'exact' })
      .order('nombre')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (search) query = query.ilike('nombre', `%${search}%`)

    const { data, count, error } = await query
    if (error) toast.error('Error al cargar familias', { description: error.message })
    setFamilias(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search])

  const loadProductosPorFamilia = useCallback(async () => {
    const { data } = await supabase
      .from('productos')
      .select('familia_id')
      .eq('activo', true)
    const counts: Record<string, number> = {}
    ;(data ?? []).forEach((p: any) => {
      if (p.familia_id) counts[p.familia_id] = (counts[p.familia_id] ?? 0) + 1
    })
    setProductosPorFamilia(counts)
  }, [])

  useEffect(() => {
    loadFamilias()
    loadProductosPorFamilia()
  }, [loadFamilias, loadProductosPorFamilia])

  const openCreate = () => {
    setEditingFamilia(null)
    setActivo(true)
    reset({ activo: true, nombre: '', descripcion: '' })
    setDialogOpen(true)
  }

  const openEdit = (f: any) => {
    setEditingFamilia(f)
    setActivo(f.activo)
    reset({
      nombre: f.nombre,
      descripcion: f.descripcion ?? '',
      activo: f.activo,
    })
    setDialogOpen(true)
  }

  const openDetail = (f: any) => { setSelected(f); setDetailOpen(true) }

  const onSubmit = async (data: FamiliaFormData) => {
    setSaving(true)
    try {
      const payload = {
        nombre: data.nombre,
        descripcion: data.descripcion || null,
        activo,
      }

      if (editingFamilia) {
        const { error } = await (supabase.from('familias') as any)
          .update(payload)
          .eq('id', editingFamilia.id)
        if (error) throw error
        toast.success('Familia actualizada', { description: `${data.nombre} se guardó correctamente.` })
      } else {
        const { error } = await (supabase.from('familias') as any).insert(payload)
        if (error) throw error
        toast.success('Familia creada', { description: `${data.nombre} se registró correctamente.` })
      }

      setDialogOpen(false)
      loadFamilias()
    } catch (err: any) {
      // Manejo de violación de nombre único
      const msg = err?.code === '23505'
        ? 'Ya existe una familia con ese nombre.'
        : (err?.message ?? 'Intenta nuevamente.')
      toast.error('No se pudo guardar', { description: msg })
    } finally {
      setSaving(false)
    }
  }

  const toggleActivo = async (f: any) => {
    const { error } = await supabase.from('familias').update({ activo: !f.activo }).eq('id', f.id)
    if (error) {
      toast.error('No se pudo cambiar el estado', { description: error.message })
    } else {
      toast.success(f.activo ? 'Familia desactivada' : 'Familia activada')
      loadFamilias()
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Familias</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} familias / marcas registradas</p>
        </div>
        <Button onClick={openCreate} className="bg-green-600 hover:bg-green-700 gap-2 w-full sm:w-auto">
          <Plus className="w-4 h-4" /> Nueva Familia
        </Button>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Buscar familia..."
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : familias.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Tags className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No se encontraron familias</p>
            </div>
          ) : (
            <>
              {/* Vista móvil: cards */}
              <div className="md:hidden divide-y divide-gray-50">
                {familias.map((f) => (
                  <div key={f.id} className="p-4 hover:bg-gray-50/50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate">{f.nombre}</p>
                        {f.descripcion && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{f.descripcion}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          {productosPorFamilia[f.id] ?? 0} productos activos
                        </p>
                      </div>
                      {f.activo
                        ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200 shrink-0">Activa</Badge>
                        : <Badge variant="secondary" className="text-xs shrink-0">Inactiva</Badge>}
                    </div>
                    <div className="flex items-center gap-1 mt-3">
                      <Button variant="outline" size="sm" onClick={() => openDetail(f)} className="h-7 text-xs gap-1">
                        <Eye className="w-3.5 h-3.5" /> Ver
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(f)} className="h-7 text-xs gap-1">
                        <Edit className="w-3.5 h-3.5" /> Editar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => toggleActivo(f)} className="h-7 text-xs gap-1">
                        {f.activo ? <ToggleRight className="w-3.5 h-3.5 text-green-600" /> : <ToggleLeft className="w-3.5 h-3.5 text-gray-400" />}
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
                      {['Nombre', 'Descripción', 'Productos', 'Creada', 'Estado', 'Acciones'].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {familias.map((f) => (
                      <tr key={f.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-medium text-gray-900 max-w-[220px] truncate">{f.nombre}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs max-w-[280px] truncate">{f.descripcion ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-600">{productosPorFamilia[f.id] ?? 0}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs">{f.created_at ? formatDate(f.created_at) : '—'}</td>
                        <td className="py-3 px-4">
                          {f.activo
                            ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activa</Badge>
                            : <Badge variant="secondary" className="text-xs">Inactiva</Badge>}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openDetail(f)} className="h-7 w-7 p-0" title="Ver detalle">
                              <Eye className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openEdit(f)} className="h-7 w-7 p-0" title="Editar">
                              <Edit className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => toggleActivo(f)} className="h-7 w-7 p-0" title={f.activo ? 'Desactivar' : 'Activar'}>
                              {f.activo ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4 text-gray-400" />}
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
              <p className="text-sm text-gray-500">{total} familias</p>
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFamilia ? 'Editar Familia' : 'Nueva Familia'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div>
              <Label>Nombre *</Label>
              <Input {...register('nombre')} placeholder="Ej. Cascajo, Napolitano..." className="mt-1" />
              {errors.nombre && <p className="text-xs text-red-500 mt-1">{errors.nombre.message}</p>}
            </div>

            <div>
              <Label>Descripción</Label>
              <Textarea
                {...register('descripcion')}
                placeholder="Descripción breve de la marca o familia de productos..."
                className="mt-1 resize-none"
                rows={3}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={activo} onCheckedChange={setActivo} />
              <Label>Activa</Label>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-green-600 hover:bg-green-700 gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingFamilia ? 'Guardar Cambios' : 'Crear Familia'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Detalle */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Detalle de la Familia</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
                <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
                  <Tags className="w-6 h-6 text-green-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 truncate">{selected.nombre}</p>
                  <p className="text-xs text-gray-500">
                    Creada el {selected.created_at ? formatDate(selected.created_at) : '—'}
                  </p>
                </div>
                {selected.activo
                  ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activa</Badge>
                  : <Badge variant="secondary" className="text-xs">Inactiva</Badge>}
              </div>

              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500">Descripción</p>
                  <p className="text-gray-800">{selected.descripcion ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Productos activos</p>
                  <p className="text-gray-800 font-medium">{productosPorFamilia[selected.id] ?? 0}</p>
                </div>
              </div>

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
