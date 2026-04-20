'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Search, Edit, ToggleLeft, ToggleRight, Loader2,
  ChevronLeft, ChevronRight, Eye, Phone, Mail, MapPin,
  IdCard, Sparkles, Car, Calendar,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { useSunatReniec } from '@/lib/hooks/use-sunat-reniec'
import { formatDate } from '@/lib/utils'
import {
  CLASE_LICENCIA_OPCIONES,
  calcularEstadoVencimiento,
  ESTADO_VENCIMIENTO_CONFIG,
} from '@/lib/vehiculos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const conductorSchema = z.object({
  dni: z.string().regex(/^\d{8}$/, 'DNI debe tener 8 dígitos'),
  nombres: z.string().min(2, 'Mínimo 2 caracteres'),
  apellido_paterno: z.string().nullable().optional(),
  apellido_materno: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  email: z.string().email('Email inválido').nullable().optional().or(z.literal('')),
  licencia_numero: z.string().nullable().optional(),
  licencia_clase: z.string().nullable().optional(),
  licencia_vencimiento: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  fecha_nacimiento: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
  activo: z.boolean().default(true),
})

type ConductorFormData = z.infer<typeof conductorSchema>

const PAGE_SIZE = 15

export default function ConductoresPage() {
  const supabase = createClient()

  const [conductores, setConductores] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [vehiculosAsignados, setVehiculosAsignados] = useState<any[]>([])
  const [editing, setEditing] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [activo, setActivo] = useState(true)
  const [licenciaClase, setLicenciaClase] = useState<string>('')

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<ConductorFormData>({
    resolver: zodResolver(conductorSchema) as any,
    defaultValues: { activo: true },
  })

  const dniInput = watch('dni') ?? ''
  const { consultarDni, loading: reniecLoading } = useSunatReniec()

  const autocompletarDni = async () => {
    const data = await consultarDni((dniInput ?? '').trim())
    if (!data) return
    setValue('nombres', data.nombres, { shouldValidate: true })
    if (data.apellidoPaterno) setValue('apellido_paterno', data.apellidoPaterno, { shouldValidate: true })
    if (data.apellidoMaterno) setValue('apellido_materno', data.apellidoMaterno, { shouldValidate: true })
  }

  const loadConductores = useCallback(async () => {
    setLoading(true)
    let query: any = (supabase as any)
      .from('conductores')
      .select(
        'id, dni, nombres, apellido_paterno, apellido_materno, nombre_completo, telefono, email, licencia_numero, licencia_clase, licencia_vencimiento, direccion, fecha_nacimiento, activo, notas, created_at',
        { count: 'exact' }
      )
      .order('nombre_completo')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (debouncedSearch) {
      query = query.or(
        `nombre_completo.ilike.%${debouncedSearch}%,dni.ilike.%${debouncedSearch}%,licencia_numero.ilike.%${debouncedSearch}%`
      )
    }

    const { data, count, error } = await query
    if (error) toast.error('Error al cargar conductores', { description: error.message })
    setConductores(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, debouncedSearch])

  useEffect(() => { loadConductores() }, [loadConductores])

  const openCreate = () => {
    setEditing(null)
    setActivo(true)
    setLicenciaClase('')
    reset({
      activo: true, dni: '', nombres: '', apellido_paterno: '', apellido_materno: '',
      telefono: '', email: '', licencia_numero: '', licencia_clase: '',
      licencia_vencimiento: '', direccion: '', fecha_nacimiento: '', notas: '',
    })
    setDialogOpen(true)
  }

  const openEdit = (c: any) => {
    setEditing(c)
    setActivo(c.activo)
    setLicenciaClase(c.licencia_clase ?? '')
    reset({
      dni: c.dni ?? '',
      nombres: c.nombres ?? '',
      apellido_paterno: c.apellido_paterno ?? '',
      apellido_materno: c.apellido_materno ?? '',
      telefono: c.telefono ?? '',
      email: c.email ?? '',
      licencia_numero: c.licencia_numero ?? '',
      licencia_clase: c.licencia_clase ?? '',
      licencia_vencimiento: c.licencia_vencimiento ?? '',
      direccion: c.direccion ?? '',
      fecha_nacimiento: c.fecha_nacimiento ?? '',
      notas: c.notas ?? '',
      activo: c.activo,
    })
    setDialogOpen(true)
  }

  const openDetail = async (c: any) => {
    setSelected(c)
    setDetailOpen(true)
    // Cargar vehículos asignados
    const { data } = await (supabase as any)
      .from('vehiculos_conductores')
      .select('id, es_principal, vehiculo:vehiculos(id, placa, descripcion, tipo, activo)')
      .eq('conductor_id', c.id)
    setVehiculosAsignados(data ?? [])
  }

  const onSubmit = async (data: ConductorFormData) => {
    setSaving(true)
    try {
      const nombreCompleto = [
        data.apellido_paterno,
        data.apellido_materno,
        data.nombres,
      ].filter(Boolean).join(' ').trim() || data.nombres

      const payload: any = {
        dni: data.dni,
        nombres: data.nombres,
        apellido_paterno: data.apellido_paterno || null,
        apellido_materno: data.apellido_materno || null,
        nombre_completo: nombreCompleto,
        telefono: data.telefono || null,
        email: data.email || null,
        licencia_numero: data.licencia_numero || null,
        licencia_clase: licenciaClase || null,
        licencia_vencimiento: data.licencia_vencimiento || null,
        direccion: data.direccion || null,
        fecha_nacimiento: data.fecha_nacimiento || null,
        notas: data.notas || null,
        activo,
      }

      if (editing) {
        const { error } = await ((supabase as any).from('conductores'))
          .update(payload).eq('id', editing.id)
        if (error) throw error
        toast.success('Conductor actualizado', { description: nombreCompleto })
      } else {
        const { error } = await ((supabase as any).from('conductores'))
          .upsert(payload, { onConflict: 'dni' })
        if (error) throw error
        toast.success('Conductor registrado', { description: nombreCompleto })
      }

      setDialogOpen(false)
      loadConductores()
    } catch (err: any) {
      toast.error('No se pudo guardar', { description: err?.message ?? 'Intenta nuevamente.' })
    } finally {
      setSaving(false)
    }
  }

  const toggleActivo = async (c: any) => {
    const { error } = await ((supabase as any).from('conductores')).update({ activo: !c.activo }).eq('id', c.id)
    if (error) {
      toast.error('No se pudo cambiar el estado', { description: error.message })
    } else {
      toast.success(c.activo ? 'Conductor desactivado' : 'Conductor activado')
      loadConductores()
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Conductores</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} conductores registrados</p>
        </div>
        <Button onClick={openCreate} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2 w-full sm:w-auto">
          <Plus className="w-4 h-4" /> Nuevo Conductor
        </Button>
      </div>

      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Buscar por nombre, DNI o licencia..."
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
          ) : conductores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <IdCard className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No se encontraron conductores</p>
            </div>
          ) : (
            <>
              {/* Vista móvil */}
              <div className="md:hidden divide-y divide-gray-50">
                {conductores.map((c) => {
                  const estLic = calcularEstadoVencimiento(c.licencia_vencimiento)
                  const cfg = ESTADO_VENCIMIENTO_CONFIG[estLic]
                  return (
                    <div key={c.id} className="p-4 hover:bg-gray-50/50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">{c.nombre_completo}</p>
                          <p className="text-xs text-gray-500 font-mono">DNI: {c.dni}</p>
                          {c.licencia_numero && (
                            <p className="text-xs text-gray-500">Lic: {c.licencia_numero} · {c.licencia_clase ?? '—'}</p>
                          )}
                        </div>
                        {c.activo
                          ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200 shrink-0">Activo</Badge>
                          : <Badge variant="secondary" className="text-xs shrink-0">Inactivo</Badge>}
                      </div>
                      {c.licencia_vencimiento && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border mt-2 ${cfg.className}`}>
                          Licencia {cfg.label}
                        </span>
                      )}
                      <div className="flex items-center gap-1 mt-3">
                        <Button variant="outline" size="sm" onClick={() => openDetail(c)} className="h-7 text-xs gap-1">
                          <Eye className="w-3.5 h-3.5" /> Ver
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEdit(c)} className="h-7 text-xs gap-1">
                          <Edit className="w-3.5 h-3.5" /> Editar
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => toggleActivo(c)} className="h-7 text-xs gap-1">
                          {c.activo ? <ToggleRight className="w-3.5 h-3.5 text-green-600" /> : <ToggleLeft className="w-3.5 h-3.5 text-gray-400" />}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Vista desktop */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/50">
                    <tr>
                      {['Nombre', 'DNI', 'Licencia', 'Clase', 'Vence Lic.', 'Teléfono', 'Estado', 'Acciones'].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {conductores.map((c) => {
                      const estLic = calcularEstadoVencimiento(c.licencia_vencimiento)
                      const cfg = ESTADO_VENCIMIENTO_CONFIG[estLic]
                      return (
                        <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-3 px-4 font-medium text-gray-900 max-w-[240px] truncate">{c.nombre_completo}</td>
                          <td className="py-3 px-4 text-gray-500 font-mono text-xs">{c.dni}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs font-mono">{c.licencia_numero ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs">{c.licencia_clase ?? '—'}</td>
                          <td className="py-3 px-4">
                            {c.licencia_vencimiento ? (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.className}`}>
                                {formatDate(c.licencia_vencimiento)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="py-3 px-4 text-gray-600 text-xs">{c.telefono ?? '—'}</td>
                          <td className="py-3 px-4">
                            {c.activo
                              ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                              : <Badge variant="secondary" className="text-xs">Inactivo</Badge>}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openDetail(c)} className="h-7 w-7 p-0" title="Ver detalle">
                                <Eye className="w-3.5 h-3.5 text-gray-500" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openEdit(c)} className="h-7 w-7 p-0" title="Editar">
                                <Edit className="w-3.5 h-3.5 text-gray-500" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => toggleActivo(c)} className="h-7 w-7 p-0" title={c.activo ? 'Desactivar' : 'Activar'}>
                                {c.activo ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4 text-gray-400" />}
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
              <p className="text-sm text-gray-500">{total} conductores</p>
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
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Conductor' : 'Nuevo Conductor'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div>
              <Label>DNI *</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  {...register('dni')}
                  placeholder="12345678"
                  maxLength={8}
                  inputMode="numeric"
                  className="font-mono flex-1"
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 8)
                    setValue('dni', v, { shouldValidate: true })
                  }}
                  disabled={!!editing}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={autocompletarDni}
                  disabled={reniecLoading || (dniInput?.length ?? 0) !== 8 || !!editing}
                  className="shrink-0 gap-1 border-[#FBE600] hover:bg-[#FBE600] hover:text-black"
                  title="Consultar RENIEC"
                >
                  {reniecLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  RENIEC
                </Button>
              </div>
              {errors.dni && <p className="text-xs text-red-500 mt-1">{errors.dni.message}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label>Apellido Paterno</Label>
                <Input {...register('apellido_paterno')} className="mt-1" />
              </div>
              <div>
                <Label>Apellido Materno</Label>
                <Input {...register('apellido_materno')} className="mt-1" />
              </div>
              <div>
                <Label>Nombres *</Label>
                <Input {...register('nombres')} className="mt-1" />
                {errors.nombres && <p className="text-xs text-red-500 mt-1">{errors.nombres.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Teléfono</Label>
                <Input {...register('telefono')} placeholder="999 999 999" className="mt-1" />
              </div>
              <div>
                <Label>Email</Label>
                <Input {...register('email')} type="email" placeholder="correo@ejemplo.com" className="mt-1" />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label>N° Licencia</Label>
                <Input {...register('licencia_numero')} className="mt-1 font-mono" />
              </div>
              <div>
                <Label>Clase</Label>
                <Select value={licenciaClase} onValueChange={setLicenciaClase}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {CLASE_LICENCIA_OPCIONES.map((op) => (
                      <SelectItem key={op} value={op}>{op}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vence Licencia</Label>
                <Input {...register('licencia_vencimiento')} type="date" className="mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Fecha Nacimiento</Label>
                <Input {...register('fecha_nacimiento')} type="date" className="mt-1" />
              </div>
              <div>
                <Label>Dirección</Label>
                <Input {...register('direccion')} className="mt-1" />
              </div>
            </div>

            <div>
              <Label>Notas</Label>
              <Textarea {...register('notas')} rows={2} className="mt-1" />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={activo} onCheckedChange={setActivo} />
              <Label>Activo</Label>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editing ? 'Guardar Cambios' : 'Crear Conductor'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Detalle */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Conductor</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
                <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
                  <IdCard className="w-6 h-6 text-green-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 truncate">{selected.nombre_completo}</p>
                  <p className="text-xs text-gray-500 font-mono">DNI: {selected.dni}</p>
                </div>
                {selected.activo
                  ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activo</Badge>
                  : <Badge variant="secondary" className="text-xs">Inactivo</Badge>}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500">N° Licencia</p>
                  <p className="text-gray-800 font-mono">{selected.licencia_numero ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Clase</p>
                  <p className="text-gray-800">{selected.licencia_clase ?? '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">Vencimiento Licencia</p>
                  {selected.licencia_vencimiento ? (
                    <div className="flex items-center gap-2">
                      <p className="text-gray-800">{formatDate(selected.licencia_vencimiento)}</p>
                      {(() => {
                        const est = calcularEstadoVencimiento(selected.licencia_vencimiento)
                        const cfg = ESTADO_VENCIMIENTO_CONFIG[est]
                        return (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.className}`}>
                            {cfg.label}
                          </span>
                        )
                      })()}
                    </div>
                  ) : <p className="text-gray-500">—</p>}
                </div>
              </div>

              <div className="space-y-3 text-sm">
                {selected.telefono && (
                  <div className="flex items-start gap-3">
                    <Phone className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Teléfono</p>
                      <a href={`tel:${selected.telefono}`} className="text-green-700 font-medium">{selected.telefono}</a>
                    </div>
                  </div>
                )}
                {selected.email && (
                  <div className="flex items-start gap-3">
                    <Mail className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Email</p>
                      <a href={`mailto:${selected.email}`} className="text-green-700 font-medium break-all">{selected.email}</a>
                    </div>
                  </div>
                )}
                {selected.direccion && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Dirección</p>
                      <p className="text-gray-800">{selected.direccion}</p>
                    </div>
                  </div>
                )}
                {selected.fecha_nacimiento && (
                  <div className="flex items-start gap-3">
                    <Calendar className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Fecha de Nacimiento</p>
                      <p className="text-gray-800">{formatDate(selected.fecha_nacimiento)}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                  <Car className="w-3.5 h-3.5" /> Vehículos Asignados ({vehiculosAsignados.length})
                </p>
                {vehiculosAsignados.length === 0 ? (
                  <p className="text-xs text-gray-400">Sin vehículos asignados.</p>
                ) : (
                  <div className="space-y-1">
                    {vehiculosAsignados.map((vc: any) => (
                      <div key={vc.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono font-bold text-gray-900 text-sm">{vc.vehiculo?.placa}</p>
                          <p className="text-xs text-gray-500 truncate">{vc.vehiculo?.descripcion ?? '—'}</p>
                        </div>
                        {vc.es_principal && (
                          <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-200">Principal</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selected.notas && (
                <div className="pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500">Notas</p>
                  <p className="text-gray-700 text-sm">{selected.notas}</p>
                </div>
              )}

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
