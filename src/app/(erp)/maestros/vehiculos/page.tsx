'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Edit, ToggleLeft, ToggleRight, Loader2, Truck, Eye,
  Search, ChevronLeft, ChevronRight,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

// ENUM tipo_vehiculo en la BD: 'zona' | 'auxiliar'
const vehiculoSchema = z.object({
  placa: z.string().min(5, 'Mínimo 5 caracteres').max(10, 'Máximo 10 caracteres'),
  descripcion: z.string().min(2, 'Mínimo 2 caracteres'),
  tipo: z.enum(['zona', 'auxiliar']),
  capacidad_kg: z.coerce.number().min(0).optional(),
  activo: z.boolean().default(true),
})

type VehiculoFormData = z.infer<typeof vehiculoSchema>

const TIPO_CONFIG: Record<string, { label: string; className: string }> = {
  zona: { label: 'Zona', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  auxiliar: { label: 'Auxiliar', className: 'bg-purple-100 text-purple-700 border-purple-200' },
}

const PAGE_SIZE = 15

export default function VehiculosPage() {
  const supabase = createClient()

  const [vehiculos, setVehiculos] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [editingVehiculo, setEditingVehiculo] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [tipo, setTipo] = useState<'zona' | 'auxiliar'>('zona')
  const [activo, setActivo] = useState(true)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<VehiculoFormData>({
    resolver: zodResolver(vehiculoSchema) as any,
    defaultValues: { tipo: 'zona', activo: true },
  })

  const loadVehiculos = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('vehiculos')
      .select('id, placa, descripcion, tipo, capacidad_kg, activo, created_at', { count: 'exact' })
      .order('placa')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (debouncedSearch) query = query.ilike('placa', `%${debouncedSearch.toUpperCase()}%`)

    const { data, count, error } = await query
    if (error) toast.error('Error al cargar vehículos', { description: error.message })
    setVehiculos(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, debouncedSearch])

  useEffect(() => { loadVehiculos() }, [loadVehiculos])

  const openCreate = () => {
    setEditingVehiculo(null)
    setTipo('zona')
    setActivo(true)
    reset({ tipo: 'zona', activo: true, placa: '', descripcion: '', capacidad_kg: 0 })
    setDialogOpen(true)
  }

  const openEdit = (v: any) => {
    setEditingVehiculo(v)
    setTipo(v.tipo)
    setActivo(v.activo)
    reset({
      placa: v.placa,
      descripcion: v.descripcion ?? '',
      tipo: v.tipo,
      capacidad_kg: v.capacidad_kg ?? 0,
      activo: v.activo,
    })
    setDialogOpen(true)
  }

  const openDetail = (v: any) => { setSelected(v); setDetailOpen(true) }

  const onSubmit = async (data: VehiculoFormData) => {
    setSaving(true)
    try {
      const payload = {
        placa: data.placa.toUpperCase(),
        descripcion: data.descripcion,
        tipo,
        capacidad_kg: data.capacidad_kg ?? 0,
        activo,
      }

      if (editingVehiculo) {
        const { error } = await (supabase.from('vehiculos') as any)
          .update(payload)
          .eq('id', editingVehiculo.id)
        if (error) throw error
        toast.success('Vehículo actualizado', { description: `${payload.placa} se guardó correctamente.` })
      } else {
        const { error } = await (supabase.from('vehiculos') as any).insert(payload)
        if (error) throw error
        toast.success('Vehículo creado', { description: `${payload.placa} se registró correctamente.` })
      }

      setDialogOpen(false)
      loadVehiculos()
    } catch (err: any) {
      toast.error('No se pudo guardar', { description: err?.message ?? 'Intenta nuevamente.' })
    } finally {
      setSaving(false)
    }
  }

  const toggleActivo = async (v: any) => {
    const { error } = await supabase.from('vehiculos').update({ activo: !v.activo }).eq('id', v.id)
    if (error) {
      toast.error('No se pudo cambiar el estado', { description: error.message })
    } else {
      toast.success(v.activo ? 'Vehículo desactivado' : 'Vehículo activado')
      loadVehiculos()
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vehículos</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} vehículos registrados</p>
        </div>
        <Button onClick={openCreate} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2 w-full sm:w-auto">
          <Plus className="w-4 h-4" /> Nuevo Vehículo
        </Button>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Buscar por placa..."
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
          ) : vehiculos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Truck className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No se encontraron vehículos</p>
            </div>
          ) : (
            <>
              {/* Vista móvil: cards */}
              <div className="md:hidden divide-y divide-gray-50">
                {vehiculos.map((v) => {
                  const tipoCfg = TIPO_CONFIG[v.tipo] ?? TIPO_CONFIG.auxiliar
                  return (
                    <div key={v.id} className="p-4 hover:bg-gray-50/50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono font-bold text-gray-900">{v.placa}</p>
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{v.descripcion ?? '—'}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${tipoCfg.className}`}>
                              {tipoCfg.label}
                            </span>
                            {v.capacidad_kg ? (
                              <span className="text-xs text-gray-500">{Number(v.capacidad_kg).toLocaleString('es-PE')} kg</span>
                            ) : null}
                          </div>
                        </div>
                        {v.activo
                          ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200 shrink-0">Activo</Badge>
                          : <Badge variant="secondary" className="text-xs shrink-0">Inactivo</Badge>}
                      </div>
                      <div className="flex items-center gap-1 mt-3">
                        <Button variant="outline" size="sm" onClick={() => openDetail(v)} className="h-7 text-xs gap-1">
                          <Eye className="w-3.5 h-3.5" /> Ver
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEdit(v)} className="h-7 text-xs gap-1">
                          <Edit className="w-3.5 h-3.5" /> Editar
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => toggleActivo(v)} className="h-7 text-xs gap-1">
                          {v.activo ? <ToggleRight className="w-3.5 h-3.5 text-green-600" /> : <ToggleLeft className="w-3.5 h-3.5 text-gray-400" />}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Vista desktop: tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {['Placa', 'Descripción', 'Tipo', 'Capacidad', 'Registrado', 'Estado', 'Acciones'].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {vehiculos.map((v) => {
                      const tipoCfg = TIPO_CONFIG[v.tipo] ?? TIPO_CONFIG.auxiliar
                      return (
                        <tr key={v.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-gray-800">{v.placa}</td>
                          <td className="py-3 px-4 text-gray-700 max-w-[280px] truncate">{v.descripcion ?? '—'}</td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${tipoCfg.className}`}>
                              {tipoCfg.label}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-600 text-xs">
                            {v.capacidad_kg ? `${Number(v.capacidad_kg).toLocaleString('es-PE')} kg` : '—'}
                          </td>
                          <td className="py-3 px-4 text-gray-500 text-xs">
                            {v.created_at ? formatDate(v.created_at) : '—'}
                          </td>
                          <td className="py-3 px-4">
                            {v.activo
                              ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                              : <Badge variant="secondary" className="text-xs">Inactivo</Badge>}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openDetail(v)} className="h-7 w-7 p-0" title="Ver detalle">
                                <Eye className="w-3.5 h-3.5 text-gray-500" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openEdit(v)} className="h-7 w-7 p-0" title="Editar">
                                <Edit className="w-3.5 h-3.5 text-gray-500" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => toggleActivo(v)} className="h-7 w-7 p-0" title={v.activo ? 'Desactivar' : 'Activar'}>
                                {v.activo ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-500">{total} vehículos</p>
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
            <DialogTitle>{editingVehiculo ? 'Editar Vehículo' : 'Nuevo Vehículo'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Placa *</Label>
                <Input
                  {...register('placa')}
                  placeholder="ABC-123"
                  className="mt-1 font-mono uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
                {errors.placa && <p className="text-xs text-red-500 mt-1">{errors.placa.message}</p>}
              </div>
              <div>
                <Label>Tipo *</Label>
                <Select value={tipo} onValueChange={(v) => setTipo(v as 'zona' | 'auxiliar')}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zona">Zona</SelectItem>
                    <SelectItem value="auxiliar">Auxiliar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Descripción *</Label>
              <Input {...register('descripcion')} placeholder="Ej. Camioneta reparto norte" className="mt-1" />
              {errors.descripcion && <p className="text-xs text-red-500 mt-1">{errors.descripcion.message}</p>}
            </div>

            <div>
              <Label>Capacidad (kg)</Label>
              <Input {...register('capacidad_kg')} type="number" min={0} step="0.01" placeholder="1000" className="mt-1" />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={activo} onCheckedChange={setActivo} />
              <Label>Activo</Label>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingVehiculo ? 'Guardar Cambios' : 'Crear Vehículo'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Detalle */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Detalle del Vehículo</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
                <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
                  <Truck className="w-6 h-6 text-green-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-mono font-bold text-gray-900 truncate">{selected.placa}</p>
                  <p className="text-xs text-gray-500 truncate">{selected.descripcion ?? '—'}</p>
                </div>
                {selected.activo
                  ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                  : <Badge variant="secondary" className="text-xs">Inactivo</Badge>}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500">Tipo</p>
                  <p className="text-gray-800 font-medium">
                    {(TIPO_CONFIG[selected.tipo] ?? TIPO_CONFIG.auxiliar).label}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Capacidad</p>
                  <p className="text-gray-800 font-medium">
                    {selected.capacidad_kg
                      ? `${Number(selected.capacidad_kg).toLocaleString('es-PE')} kg`
                      : '—'}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">Descripción</p>
                  <p className="text-gray-800">{selected.descripcion ?? '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">Fecha de registro</p>
                  <p className="text-gray-800">
                    {selected.created_at ? formatDate(selected.created_at) : '—'}
                  </p>
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
