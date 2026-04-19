'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Edit, ToggleLeft, ToggleRight, Loader2, Map, Eye, Search,
  MapPin, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'

const zonaSchema = z.object({
  nombre: z.string().min(2, 'Mínimo 2 caracteres'),
  descripcion: z.string().nullable().optional(),
  activo: z.boolean().default(true),
})

type ZonaFormData = z.infer<typeof zonaSchema>

export default function ZonasPage() {
  const supabase = createClient()

  const [zonas, setZonas] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [editingZona, setEditingZona] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [activoVal, setActivoVal] = useState(true)

  // Cantidad de clientes por zona
  const [clientesPorZona, setClientesPorZona] = useState<Record<string, number>>({})

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ZonaFormData>({
    resolver: zodResolver(zonaSchema) as any,
    defaultValues: { activo: true },
  })

  const loadZonas = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('zonas')
      .select('id, nombre, descripcion, activo, created_at', { count: 'exact' })
      .order('nombre')

    if (debouncedSearch) query = query.ilike('nombre', `%${debouncedSearch}%`)

    const { data, count, error } = await query
    if (error) toast.error('Error al cargar zonas', { description: error.message })
    setZonas(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [debouncedSearch])

  const loadClientesPorZona = useCallback(async () => {
    const { data } = await supabase
      .from('clientes')
      .select('zona_id')
      .eq('estado', 'activo')
    const counts: Record<string, number> = {}
    ;(data ?? []).forEach((c: any) => {
      if (c.zona_id) counts[c.zona_id] = (counts[c.zona_id] ?? 0) + 1
    })
    setClientesPorZona(counts)
  }, [])

  useEffect(() => {
    loadZonas()
    loadClientesPorZona()
  }, [loadZonas, loadClientesPorZona])

  const openCreate = () => {
    setEditingZona(null)
    setActivoVal(true)
    reset({ activo: true, nombre: '', descripcion: '' })
    setDialogOpen(true)
  }

  const openEdit = (zona: any) => {
    setEditingZona(zona)
    setActivoVal(zona.activo)
    reset({
      nombre: zona.nombre,
      descripcion: zona.descripcion ?? '',
      activo: zona.activo,
    })
    setDialogOpen(true)
  }

  const openDetail = (z: any) => { setSelected(z); setDetailOpen(true) }

  const onSubmit = async (data: ZonaFormData) => {
    setSaving(true)
    try {
      const payload = {
        nombre: data.nombre,
        descripcion: data.descripcion || null,
        activo: activoVal,
      }

      if (editingZona) {
        const { error } = await (supabase.from('zonas') as any)
          .update(payload)
          .eq('id', editingZona.id)
        if (error) throw error
        toast.success('Zona actualizada', { description: `${data.nombre} se guardó correctamente.` })
      } else {
        const { error } = await (supabase.from('zonas') as any).insert(payload)
        if (error) throw error
        toast.success('Zona creada', { description: `${data.nombre} se registró correctamente.` })
      }

      setDialogOpen(false)
      loadZonas()
    } catch (err: any) {
      toast.error('No se pudo guardar', { description: err?.message ?? 'Intenta nuevamente.' })
    } finally {
      setSaving(false)
    }
  }

  const toggleActivo = async (zona: any) => {
    const { error } = await supabase.from('zonas').update({ activo: !zona.activo }).eq('id', zona.id)
    if (error) {
      toast.error('No se pudo cambiar el estado', { description: error.message })
    } else {
      toast.success(zona.activo ? 'Zona desactivada' : 'Zona activada')
      loadZonas()
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Zonas de Distribución</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} zonas registradas</p>
        </div>
        <Button onClick={openCreate} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2 w-full sm:w-auto">
          <Plus className="w-4 h-4" /> Nueva Zona
        </Button>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Buscar zona..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
        </div>
      ) : zonas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Map className="w-10 h-10 mb-3 text-gray-300" />
          <p className="text-sm">No se encontraron zonas</p>
        </div>
      ) : (
        <>
          {/* Vista móvil: cards grid */}
          <div className="md:hidden grid grid-cols-1 sm:grid-cols-2 gap-3">
            {zonas.map((z) => (
              <Card
                key={z.id}
                className={`border shadow-sm transition-all ${z.activo ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                      <Map className="w-5 h-5 text-green-600" />
                    </div>
                    {z.activo
                      ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activa</Badge>
                      : <Badge variant="secondary" className="text-xs">Inactiva</Badge>}
                  </div>
                  <p className="font-bold text-gray-900 mt-3">{z.nombre}</p>
                  {z.descripcion && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{z.descripcion}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    {clientesPorZona[z.id] ?? 0} clientes activos
                  </p>
                  <div className="flex items-center gap-1 mt-3">
                    <Button variant="outline" size="sm" onClick={() => openDetail(z)} className="h-7 text-xs gap-1">
                      <Eye className="w-3.5 h-3.5" /> Ver
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(z)} className="h-7 text-xs gap-1">
                      <Edit className="w-3.5 h-3.5" /> Editar
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => toggleActivo(z)} className="h-7 text-xs gap-1">
                      {z.activo ? <ToggleRight className="w-3.5 h-3.5 text-green-600" /> : <ToggleLeft className="w-3.5 h-3.5 text-gray-400" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Vista desktop: tabla */}
          <Card className="hidden md:block border-gray-200 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {['Zona', 'Descripción', 'Clientes', 'Creada', 'Estado', 'Acciones'].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {zonas.map((z) => (
                      <tr key={z.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-semibold text-gray-800">{z.nombre}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs max-w-[280px] truncate">{z.descripcion ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-600">{clientesPorZona[z.id] ?? 0}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs">{z.created_at ? formatDate(z.created_at) : '—'}</td>
                        <td className="py-3 px-4">
                          {z.activo
                            ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activa</Badge>
                            : <Badge variant="secondary" className="text-xs">Inactiva</Badge>
                          }
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openDetail(z)} className="h-7 w-7 p-0" title="Ver detalle">
                              <Eye className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openEdit(z)} className="h-7 w-7 p-0" title="Editar">
                              <Edit className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => toggleActivo(z)} className="h-7 w-7 p-0" title={z.activo ? 'Desactivar' : 'Activar'}>
                              {z.activo ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Dialog Crear/Editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingZona ? 'Editar Zona' : 'Nueva Zona'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div>
              <Label>Nombre de la Zona *</Label>
              <Input {...register('nombre')} placeholder="Ej. Zona Norte, Zona Comercial..." className="mt-1" />
              {errors.nombre && <p className="text-xs text-red-500 mt-1">{errors.nombre.message}</p>}
            </div>

            <div>
              <Label>Descripción</Label>
              <Textarea
                {...register('descripcion')}
                placeholder="Descripción del área geográfica o cobertura de la zona..."
                className="mt-1 resize-none"
                rows={3}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={activoVal} onCheckedChange={setActivoVal} />
              <Label>Zona activa</Label>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingZona ? 'Guardar Cambios' : 'Crear Zona'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Detalle */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Detalle de la Zona</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
                <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
                  <Map className="w-6 h-6 text-green-600" />
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
                {selected.descripcion && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Descripción</p>
                      <p className="text-gray-800">{selected.descripcion}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <Users className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-500">Clientes activos</p>
                    <p className="text-gray-800 font-medium">{clientesPorZona[selected.id] ?? 0}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-3 border-t border-gray-100">
                <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>
                <Button onClick={() => { setDetailOpen(false); openEdit(selected) }} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
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
