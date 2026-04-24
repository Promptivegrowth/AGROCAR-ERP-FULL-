'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Edit, ToggleLeft, ToggleRight, Loader2, Truck, Eye,
  Search, ChevronLeft, ChevronRight, Sparkles, Trash2, IdCard,
  Wrench, AlertCircle, CheckCircle2, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { useSunatReniec } from '@/lib/hooks/use-sunat-reniec'
import { formatDate, formatCurrency } from '@/lib/utils'
import {
  CLASE_LICENCIA_OPCIONES,
  TIPO_MANT_LABELS,
  TIPO_MANT_OPCIONES,
  calcularEstadoVencimiento,
  ESTADO_VENCIMIENTO_CONFIG,
  ESTADO_MULTA_CONFIG,
} from '@/lib/vehiculos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// ENUM tipo_vehiculo en la BD: 'zona' | 'auxiliar'
const vehiculoSchema = z.object({
  placa: z.string().min(5, 'Mínimo 5 caracteres').max(10, 'Máximo 10 caracteres'),
  descripcion: z.string().min(2, 'Mínimo 2 caracteres'),
  tipo: z.enum(['zona', 'auxiliar']),
  capacidad_kg: z.coerce.number().positive('Debe ser mayor a 0'),
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

  // Detalle: conductores / mantenimientos / multas
  const [conductoresAsignados, setConductoresAsignados] = useState<any[]>([])
  const [mantenimientos, setMantenimientos] = useState<any[]>([])
  const [multas, setMultas] = useState<any[]>([])
  const [loadingDetalle, setLoadingDetalle] = useState(false)

  // Submodales
  const [asignarOpen, setAsignarOpen] = useState(false)
  const [mantOpen, setMantOpen] = useState(false)
  const [multaOpen, setMultaOpen] = useState(false)
  const [pagarMultaOpen, setPagarMultaOpen] = useState(false)
  const [multaAPagar, setMultaAPagar] = useState<any>(null)

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

  const loadDetalleVehiculo = async (vehiculoId: string) => {
    setLoadingDetalle(true)
    const sb: any = supabase
    const [{ data: condData }, { data: mantData }, { data: multaData }] = await Promise.all([
      sb
        .from('vehiculos_conductores')
        .select('id, es_principal, conductor:conductores(id, dni, nombre_completo, licencia_numero, licencia_clase, licencia_vencimiento, telefono, activo)')
        .eq('vehiculo_id', vehiculoId),
      sb
        .from('mantenimientos_vehiculo')
        .select('*')
        .eq('vehiculo_id', vehiculoId)
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false }),
      sb
        .from('multas_vehiculo')
        .select('*, conductor:conductores(id, nombre_completo, dni)')
        .eq('vehiculo_id', vehiculoId)
        .order('fecha_emision', { ascending: false }),
    ])
    setConductoresAsignados(condData ?? [])
    setMantenimientos(mantData ?? [])
    setMultas(multaData ?? [])
    setLoadingDetalle(false)
  }

  const openCreate = () => {
    setEditingVehiculo(null)
    setTipo('zona')
    setActivo(true)
    reset({ tipo: 'zona', activo: true, placa: '', descripcion: '', capacidad_kg: 500 })
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
      capacidad_kg: v.capacidad_kg ?? 500,
      activo: v.activo,
    })
    setDialogOpen(true)
  }

  const openDetail = async (v: any) => {
    setSelected(v)
    setDetailOpen(true)
    await loadDetalleVehiculo(v.id)
  }

  const onSubmit = async (data: VehiculoFormData) => {
    setSaving(true)
    try {
      const payload = {
        placa: data.placa.toUpperCase(),
        descripcion: data.descripcion,
        tipo,
        capacidad_kg: data.capacidad_kg,
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

  const desasignarConductor = async (vcId: string) => {
    const { error } = await ((supabase as any).from('vehiculos_conductores')).delete().eq('id', vcId)
    if (error) {
      toast.error('No se pudo desasignar', { description: error.message })
    } else {
      toast.success('Conductor desasignado')
      if (selected) loadDetalleVehiculo(selected.id)
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
              <Label>Capacidad (kg) *</Label>
              <Input {...register('capacidad_kg')} type="number" min={1} step="0.01" placeholder="500" className="mt-1 font-mono" />
              {errors.capacidad_kg ? (
                <p className="text-xs text-red-500 mt-1">{errors.capacidad_kg.message as string}</p>
              ) : (
                <p className="text-[11px] text-gray-400 mt-1">
                  Carga máxima del vehículo. Se usa en despacho para validar que los pedidos quepan.
                </p>
              )}
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

      {/* Dialog Detalle con Tabs */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
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

              <Tabs defaultValue="info" className="w-full">
                <TabsList className="grid grid-cols-4 w-full">
                  <TabsTrigger value="info">Info</TabsTrigger>
                  <TabsTrigger value="conductores">Conductores ({conductoresAsignados.length})</TabsTrigger>
                  <TabsTrigger value="mantenimientos">Mantenimientos ({mantenimientos.length})</TabsTrigger>
                  <TabsTrigger value="multas">Multas ({multas.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="info" className="mt-4">
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
                  <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 mt-4 border-t border-gray-100">
                    <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>
                    <Button onClick={() => { setDetailOpen(false); openEdit(selected) }} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                      <Edit className="w-4 h-4" /> Editar
                    </Button>
                  </div>
                </TabsContent>

                {/* Tab Conductores */}
                <TabsContent value="conductores" className="mt-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <p className="text-sm text-gray-600">Conductores vinculados al vehículo</p>
                    <Button size="sm" onClick={() => setAsignarOpen(true)} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-1">
                      <Plus className="w-3.5 h-3.5" /> Asignar Conductor
                    </Button>
                  </div>
                  {loadingDetalle ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                  ) : conductoresAsignados.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">
                      <IdCard className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                      Sin conductores asignados
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {conductoresAsignados.map((vc: any) => {
                        const cond = vc.conductor
                        const est = calcularEstadoVencimiento(cond?.licencia_vencimiento)
                        const cfg = ESTADO_VENCIMIENTO_CONFIG[est]
                        return (
                          <div key={vc.id} className="flex items-start justify-between gap-3 p-3 bg-gray-50 rounded-lg">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-gray-900 truncate">{cond?.nombre_completo}</p>
                                {vc.es_principal && (
                                  <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-200">Principal</Badge>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 font-mono">DNI: {cond?.dni}</p>
                              {cond?.licencia_numero && (
                                <p className="text-xs text-gray-500">
                                  Lic: {cond.licencia_numero} · {cond.licencia_clase ?? '—'}
                                </p>
                              )}
                              {cond?.licencia_vencimiento && (
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-gray-500">Vence: {formatDate(cond.licencia_vencimiento)}</span>
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${cfg.className}`}>
                                    {cfg.label}
                                  </span>
                                </div>
                              )}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => desasignarConductor(vc.id)}
                              className="shrink-0 h-7 text-xs text-red-600 hover:bg-red-50 border-red-200"
                            >
                              <Trash2 className="w-3 h-3 mr-1" /> Desasignar
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </TabsContent>

                {/* Tab Mantenimientos */}
                <TabsContent value="mantenimientos" className="mt-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <p className="text-sm text-gray-600">Alertas y mantenimientos del vehículo</p>
                    <Button size="sm" onClick={() => setMantOpen(true)} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-1">
                      <Plus className="w-3.5 h-3.5" /> Registrar
                    </Button>
                  </div>
                  {loadingDetalle ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                  ) : mantenimientos.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">
                      <Wrench className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                      Sin mantenimientos registrados
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {mantenimientos.map((m: any) => {
                        const est = calcularEstadoVencimiento(m.fecha_vencimiento)
                        const cfg = ESTADO_VENCIMIENTO_CONFIG[est]
                        const Icono = est === 'vencido' ? AlertCircle
                          : est === 'por_vencer' ? Clock
                          : CheckCircle2
                        return (
                          <div key={m.id} className="p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Icono className={`w-4 h-4 ${
                                    est === 'vencido' ? 'text-red-500'
                                      : est === 'por_vencer' ? 'text-yellow-500'
                                      : 'text-green-500'
                                  }`} />
                                  <p className="font-medium text-gray-900">{TIPO_MANT_LABELS[m.tipo] ?? m.tipo}</p>
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.className}`}>
                                    {cfg.label}
                                  </span>
                                </div>
                                {m.descripcion && <p className="text-xs text-gray-600 mt-1">{m.descripcion}</p>}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs text-gray-500">
                                  {m.fecha_realizado && <div><span className="font-medium">Realizado:</span> {formatDate(m.fecha_realizado)}</div>}
                                  {m.fecha_vencimiento && <div><span className="font-medium">Vence:</span> {formatDate(m.fecha_vencimiento)}</div>}
                                  {m.kilometraje ? <div><span className="font-medium">Km:</span> {Number(m.kilometraje).toLocaleString('es-PE')}</div> : null}
                                  {Number(m.monto) > 0 ? <div><span className="font-medium">Monto:</span> {formatCurrency(Number(m.monto))}</div> : null}
                                </div>
                                {m.proveedor && <p className="text-xs text-gray-500 mt-1"><span className="font-medium">Proveedor:</span> {m.proveedor}</p>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </TabsContent>

                {/* Tab Multas */}
                <TabsContent value="multas" className="mt-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <p className="text-sm text-gray-600">Multas de tránsito del vehículo</p>
                    <Button size="sm" onClick={() => setMultaOpen(true)} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-1">
                      <Plus className="w-3.5 h-3.5" /> Registrar
                    </Button>
                  </div>
                  {loadingDetalle ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                  ) : multas.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">
                      <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                      Sin multas registradas
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {multas.map((m: any) => {
                        const cfg = ESTADO_MULTA_CONFIG[m.estado] ?? ESTADO_MULTA_CONFIG.pendiente
                        return (
                          <div key={m.id} className="p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-medium text-gray-900">{m.tipo}</p>
                                  {m.codigo_infraccion && <span className="text-xs font-mono text-gray-500">{m.codigo_infraccion}</span>}
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.className}`}>
                                    {cfg.label}
                                  </span>
                                </div>
                                {m.conductor && (
                                  <p className="text-xs text-gray-600 mt-1">Conductor: {m.conductor.nombre_completo} · {m.conductor.dni}</p>
                                )}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs text-gray-500">
                                  <div><span className="font-medium">Emitida:</span> {formatDate(m.fecha_emision)}</div>
                                  {m.fecha_vencimiento && <div><span className="font-medium">Vence:</span> {formatDate(m.fecha_vencimiento)}</div>}
                                  <div><span className="font-medium">Monto:</span> {formatCurrency(Number(m.monto))}</div>
                                  {Number(m.descuento) > 0 && <div><span className="font-medium">Descuento:</span> {formatCurrency(Number(m.descuento))}</div>}
                                </div>
                                {m.lugar && <p className="text-xs text-gray-500 mt-1"><span className="font-medium">Lugar:</span> {m.lugar}</p>}
                                {m.observaciones && <p className="text-xs text-gray-500 mt-1">{m.observaciones}</p>}
                                {m.estado === 'pagada' && Number(m.monto_pagado) > 0 && (
                                  <p className="text-xs text-green-700 mt-1 font-medium">Pagado: {formatCurrency(Number(m.monto_pagado))}</p>
                                )}
                              </div>
                              {m.estado === 'pendiente' && (
                                <Button
                                  variant="outline" size="sm"
                                  onClick={() => { setMultaAPagar(m); setPagarMultaOpen(true) }}
                                  className="shrink-0 h-7 text-xs border-green-200 text-green-700 hover:bg-green-50"
                                >
                                  Marcar pagada
                                </Button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Submodal: Asignar Conductor */}
      {selected && (
        <AsignarConductorDialog
          open={asignarOpen}
          onOpenChange={setAsignarOpen}
          vehiculoId={selected.id}
          onDone={() => loadDetalleVehiculo(selected.id)}
        />
      )}

      {/* Submodal: Registrar Mantenimiento */}
      {selected && (
        <MantenimientoDialog
          open={mantOpen}
          onOpenChange={setMantOpen}
          vehiculoId={selected.id}
          onDone={() => loadDetalleVehiculo(selected.id)}
        />
      )}

      {/* Submodal: Registrar Multa */}
      {selected && (
        <MultaDialog
          open={multaOpen}
          onOpenChange={setMultaOpen}
          vehiculoId={selected.id}
          conductores={conductoresAsignados}
          onDone={() => loadDetalleVehiculo(selected.id)}
        />
      )}

      {/* Submodal: Marcar multa pagada */}
      <PagarMultaDialog
        open={pagarMultaOpen}
        onOpenChange={setPagarMultaOpen}
        multa={multaAPagar}
        onDone={() => { if (selected) loadDetalleVehiculo(selected.id) }}
      />
    </div>
  )
}

/* =========================================================================
   Submodal: Asignar Conductor (con RENIEC + upsert)
   ========================================================================= */

function AsignarConductorDialog({
  open, onOpenChange, vehiculoId, onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  vehiculoId: string
  onDone: () => void
}) {
  const supabase = createClient()
  const { consultarDni, loading: reniecLoading } = useSunatReniec()

  const [modo, setModo] = useState<'existente' | 'nuevo'>('existente')
  const [conductoresDisponibles, setConductoresDisponibles] = useState<any[]>([])
  const [loadingConductores, setLoadingConductores] = useState(false)
  const [conductorIdSel, setConductorIdSel] = useState<string>('')

  // Form nuevo conductor
  const [dni, setDni] = useState('')
  const [nombres, setNombres] = useState('')
  const [apPaterno, setApPaterno] = useState('')
  const [apMaterno, setApMaterno] = useState('')
  const [licNum, setLicNum] = useState('')
  const [licClase, setLicClase] = useState('')
  const [licVenc, setLicVenc] = useState('')
  const [telefono, setTelefono] = useState('')
  const [esPrincipal, setEsPrincipal] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setModo('existente')
      setConductorIdSel('')
      setDni(''); setNombres(''); setApPaterno(''); setApMaterno('')
      setLicNum(''); setLicClase(''); setLicVenc(''); setTelefono('')
      setEsPrincipal(false); setSaving(false)
      return
    }
    // Cargar conductores existentes excluyendo los ya asignados al vehículo
    ;(async () => {
      setLoadingConductores(true)
      const [{ data: todos }, { data: asignados }] = await Promise.all([
        (supabase as any).from('conductores').select('id, dni, nombre_completo, licencia_clase, telefono').eq('activo', true).order('nombre_completo'),
        (supabase as any).from('vehiculos_conductores').select('conductor_id').eq('vehiculo_id', vehiculoId),
      ])
      const asignadosIds = new Set((asignados ?? []).map((a: any) => a.conductor_id))
      setConductoresDisponibles((todos ?? []).filter((c: any) => !asignadosIds.has(c.id)))
      setLoadingConductores(false)
    })()
  }, [open, vehiculoId])

  const autocompletar = async () => {
    const data = await consultarDni(dni.trim())
    if (!data) return
    setNombres(data.nombres)
    if (data.apellidoPaterno) setApPaterno(data.apellidoPaterno)
    if (data.apellidoMaterno) setApMaterno(data.apellidoMaterno)
  }

  const asignarExistente = async () => {
    if (!conductorIdSel) {
      toast.error('Selecciona un conductor')
      return
    }
    setSaving(true)
    try {
      if (esPrincipal) {
        await ((supabase as any).from('vehiculos_conductores'))
          .update({ es_principal: false }).eq('vehiculo_id', vehiculoId)
      }
      const { error } = await ((supabase as any).from('vehiculos_conductores'))
        .upsert({ vehiculo_id: vehiculoId, conductor_id: conductorIdSel, es_principal: esPrincipal },
          { onConflict: 'vehiculo_id,conductor_id' })
      if (error) throw error
      const cond = conductoresDisponibles.find((c) => c.id === conductorIdSel)
      toast.success('Conductor asignado', { description: cond?.nombre_completo ?? '' })
      onOpenChange(false)
      onDone()
    } catch (err: any) {
      toast.error('No se pudo asignar', { description: err?.message ?? '' })
    } finally { setSaving(false) }
  }

  const crearYAsignar = async () => {
    if (!/^\d{8}$/.test(dni)) { toast.error('DNI inválido', { description: 'Debe tener 8 dígitos.' }); return }
    if (!nombres.trim()) { toast.error('Nombres requeridos'); return }
    setSaving(true)
    try {
      const nombreCompleto = [apPaterno, apMaterno, nombres].filter(Boolean).join(' ').trim() || nombres
      const { data: condData, error: condErr } = await ((supabase as any).from('conductores'))
        .upsert({
          dni, nombres,
          apellido_paterno: apPaterno || null,
          apellido_materno: apMaterno || null,
          nombre_completo: nombreCompleto,
          telefono: telefono || null,
          licencia_numero: licNum || null,
          licencia_clase: licClase || null,
          licencia_vencimiento: licVenc || null,
        }, { onConflict: 'dni' })
        .select('id').single()
      if (condErr) throw condErr

      if (esPrincipal) {
        await ((supabase as any).from('vehiculos_conductores'))
          .update({ es_principal: false }).eq('vehiculo_id', vehiculoId)
      }
      const { error: vcErr } = await ((supabase as any).from('vehiculos_conductores'))
        .upsert({ vehiculo_id: vehiculoId, conductor_id: condData.id, es_principal: esPrincipal },
          { onConflict: 'vehiculo_id,conductor_id' })
      if (vcErr) throw vcErr

      toast.success('Conductor creado y asignado', { description: nombreCompleto })
      onOpenChange(false)
      onDone()
    } catch (err: any) {
      toast.error('No se pudo asignar', { description: err?.message ?? '' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Asignar Conductor</DialogTitle>
        </DialogHeader>

        <Tabs value={modo} onValueChange={(v) => setModo(v as 'existente' | 'nuevo')} className="mt-2">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="existente">Elegir existente</TabsTrigger>
            <TabsTrigger value="nuevo">Crear nuevo</TabsTrigger>
          </TabsList>

          <TabsContent value="existente" className="space-y-4 mt-4">
            <div>
              <Label>Conductor *</Label>
              {loadingConductores ? (
                <div className="mt-1 flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Cargando conductores...
                </div>
              ) : conductoresDisponibles.length === 0 ? (
                <div className="mt-1 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  No hay conductores disponibles. Crea uno en{' '}
                  <a href="/maestros/conductores" className="underline font-medium">Maestros → Conductores</a>
                  {' '}o usa la pestaña &quot;Crear nuevo&quot;.
                </div>
              ) : (
                <Select value={conductorIdSel} onValueChange={setConductorIdSel}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar conductor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {conductoresDisponibles.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nombre_completo} · DNI {c.dni}{c.licencia_clase ? ` · Lic ${c.licencia_clase}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={esPrincipal} onCheckedChange={setEsPrincipal} />
              <Label>Conductor principal de este vehículo</Label>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button
                onClick={asignarExistente}
                disabled={saving || !conductorIdSel}
                className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Asignar
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="nuevo" className="space-y-4 mt-4">
            <div>
              <Label>DNI *</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={dni}
                  onChange={(e) => setDni(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="12345678"
                  maxLength={8}
                  inputMode="numeric"
                  className="font-mono flex-1"
                />
                <Button
                  type="button" variant="outline" size="sm" onClick={autocompletar}
                  disabled={reniecLoading || dni.length !== 8}
                  className="shrink-0 gap-1 border-[#FBE600] hover:bg-[#FBE600] hover:text-black"
                >
                  {reniecLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  RENIEC
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><Label>Ap. Paterno</Label><Input value={apPaterno} onChange={(e) => setApPaterno(e.target.value)} className="mt-1" /></div>
              <div><Label>Ap. Materno</Label><Input value={apMaterno} onChange={(e) => setApMaterno(e.target.value)} className="mt-1" /></div>
              <div><Label>Nombres *</Label><Input value={nombres} onChange={(e) => setNombres(e.target.value)} className="mt-1" /></div>
            </div>
            <div><Label>Teléfono</Label><Input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="999 999 999" className="mt-1" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><Label>N° Licencia</Label><Input value={licNum} onChange={(e) => setLicNum(e.target.value)} className="mt-1 font-mono" /></div>
              <div>
                <Label>Clase</Label>
                <Select value={licClase} onValueChange={setLicClase}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                  <SelectContent>
                    {CLASE_LICENCIA_OPCIONES.map((op) => <SelectItem key={op} value={op}>{op}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Vencimiento</Label><Input type="date" value={licVenc} onChange={(e) => setLicVenc(e.target.value)} className="mt-1" /></div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={esPrincipal} onCheckedChange={setEsPrincipal} />
              <Label>Conductor principal</Label>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={crearYAsignar} disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Crear y asignar
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

/* =========================================================================
   Submodal: Registrar Mantenimiento
   ========================================================================= */

function MantenimientoDialog({
  open, onOpenChange, vehiculoId, onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  vehiculoId: string
  onDone: () => void
}) {
  const supabase = createClient()
  const [tipoMant, setTipoMant] = useState<string>('soat')
  const [fechaRealizado, setFechaRealizado] = useState('')
  const [fechaVenc, setFechaVenc] = useState('')
  const [km, setKm] = useState<string>('')
  const [monto, setMonto] = useState<string>('')
  const [proveedor, setProveedor] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setTipoMant('soat'); setFechaRealizado(''); setFechaVenc('')
      setKm(''); setMonto(''); setProveedor('')
      setDescripcion(''); setObservaciones(''); setSaving(false)
    }
  }, [open])

  const submit = async () => {
    setSaving(true)
    try {
      const payload: any = {
        vehiculo_id: vehiculoId,
        tipo: tipoMant,
        descripcion: descripcion || null,
        fecha_realizado: fechaRealizado || null,
        fecha_vencimiento: fechaVenc || null,
        kilometraje: km ? parseInt(km, 10) : null,
        monto: monto ? parseFloat(monto) : 0,
        proveedor: proveedor || null,
        observaciones: observaciones || null,
        estado: fechaVenc ? 'vigente' : 'pendiente',
      }
      const { error } = await ((supabase as any).from('mantenimientos_vehiculo')).insert(payload)
      if (error) throw error
      toast.success('Mantenimiento registrado', { description: TIPO_MANT_LABELS[tipoMant] })
      onOpenChange(false)
      onDone()
    } catch (err: any) {
      toast.error('No se pudo registrar', { description: err?.message ?? 'Intenta de nuevo.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar Mantenimiento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label>Tipo *</Label>
            <Select value={tipoMant} onValueChange={setTipoMant}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPO_MANT_OPCIONES.map((op) => (
                  <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Fecha Realizado</Label>
              <Input type="date" value={fechaRealizado} onChange={(e) => setFechaRealizado(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Fecha Vencimiento</Label>
              <Input type="date" value={fechaVenc} onChange={(e) => setFechaVenc(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Kilometraje</Label>
              <Input type="number" min={0} value={km} onChange={(e) => setKm(e.target.value)} placeholder="0" className="mt-1" />
            </div>
            <div>
              <Label>Monto (S/)</Label>
              <Input type="number" min={0} step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className="mt-1" />
            </div>
          </div>

          <div>
            <Label>Proveedor</Label>
            <Input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Taller, aseguradora, etc." className="mt-1" />
          </div>

          <div>
            <Label>Descripción</Label>
            <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label>Observaciones</Label>
            <Textarea rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className="mt-1" />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Registrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* =========================================================================
   Submodal: Registrar Multa
   ========================================================================= */

function MultaDialog({
  open, onOpenChange, vehiculoId, conductores, onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  vehiculoId: string
  conductores: any[]
  onDone: () => void
}) {
  const supabase = createClient()
  const [conductorId, setConductorId] = useState<string>('')
  const [codigo, setCodigo] = useState('')
  const [tipo, setTipo] = useState('')
  const [fechaEmision, setFechaEmision] = useState(() => new Date().toISOString().split('T')[0])
  const [fechaVenc, setFechaVenc] = useState('')
  const [monto, setMonto] = useState('')
  const [descuento, setDescuento] = useState('')
  const [lugar, setLugar] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setConductorId(''); setCodigo(''); setTipo('')
      setFechaEmision(new Date().toISOString().split('T')[0]); setFechaVenc('')
      setMonto(''); setDescuento(''); setLugar(''); setObservaciones(''); setSaving(false)
    }
  }, [open])

  const submit = async () => {
    if (!tipo.trim()) {
      toast.error('El tipo de infracción es requerido')
      return
    }
    setSaving(true)
    try {
      const payload: any = {
        vehiculo_id: vehiculoId,
        conductor_id: conductorId || null,
        codigo_infraccion: codigo || null,
        tipo,
        fecha_emision: fechaEmision,
        fecha_vencimiento: fechaVenc || null,
        monto: monto ? parseFloat(monto) : 0,
        descuento: descuento ? parseFloat(descuento) : 0,
        lugar: lugar || null,
        observaciones: observaciones || null,
        estado: 'pendiente',
      }
      const { error } = await ((supabase as any).from('multas_vehiculo')).insert(payload)
      if (error) throw error
      toast.success('Multa registrada')
      onOpenChange(false)
      onDone()
    } catch (err: any) {
      toast.error('No se pudo registrar', { description: err?.message ?? 'Intenta de nuevo.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar Multa</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label>Conductor</Label>
            <Select value={conductorId} onValueChange={setConductorId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Sin conductor asignado" />
              </SelectTrigger>
              <SelectContent>
                {conductores.map((vc: any) => (
                  <SelectItem key={vc.conductor.id} value={vc.conductor.id}>
                    {vc.conductor.nombre_completo} · {vc.conductor.dni}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Código Infracción</Label>
              <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="M-01" className="mt-1 font-mono" />
            </div>
            <div>
              <Label>Tipo *</Label>
              <Input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Exceso de velocidad" className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Fecha Emisión *</Label>
              <Input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Fecha Vencimiento</Label>
              <Input type="date" value={fechaVenc} onChange={(e) => setFechaVenc(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Monto (S/)</Label>
              <Input type="number" min={0} step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className="mt-1" />
            </div>
            <div>
              <Label>Descuento (S/)</Label>
              <Input type="number" min={0} step="0.01" value={descuento} onChange={(e) => setDescuento(e.target.value)} placeholder="0.00" className="mt-1" />
            </div>
          </div>

          <div>
            <Label>Lugar</Label>
            <Input value={lugar} onChange={(e) => setLugar(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label>Observaciones</Label>
            <Textarea rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className="mt-1" />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Registrar Multa
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* =========================================================================
   Submodal: Marcar multa como pagada
   ========================================================================= */

function PagarMultaDialog({
  open, onOpenChange, multa, onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  multa: any | null
  onDone: () => void
}) {
  const supabase = createClient()
  const [montoPagado, setMontoPagado] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && multa) {
      const sugerido = Math.max(0, Number(multa.monto) - Number(multa.descuento ?? 0))
      setMontoPagado(sugerido.toFixed(2))
    } else if (!open) {
      setMontoPagado(''); setSaving(false)
    }
  }, [open, multa])

  if (!multa) return null

  const submit = async () => {
    setSaving(true)
    try {
      const { error } = await ((supabase as any).from('multas_vehiculo'))
        .update({
          estado: 'pagada',
          monto_pagado: montoPagado ? parseFloat(montoPagado) : 0,
        })
        .eq('id', multa.id)
      if (error) throw error
      toast.success('Multa marcada como pagada')
      onOpenChange(false)
      onDone()
    } catch (err: any) {
      toast.error('No se pudo actualizar', { description: err?.message ?? 'Intenta de nuevo.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Marcar Multa como Pagada</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="p-3 bg-gray-50 rounded-lg text-sm">
            <p className="font-medium text-gray-900">{multa.tipo}</p>
            <p className="text-xs text-gray-500">Monto: {formatCurrency(Number(multa.monto))}</p>
            {Number(multa.descuento) > 0 && (
              <p className="text-xs text-gray-500">Descuento: {formatCurrency(Number(multa.descuento))}</p>
            )}
          </div>
          <div>
            <Label>Monto Pagado (S/) *</Label>
            <Input
              type="number" min={0} step="0.01"
              value={montoPagado}
              onChange={(e) => setMontoPagado(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white font-semibold gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmar Pago
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
