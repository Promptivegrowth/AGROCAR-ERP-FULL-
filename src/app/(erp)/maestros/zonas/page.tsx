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
import UbigeoSelector, { UBIGEO_EMPTY, type UbigeoValue } from '@/components/ubigeo-selector'
import LeafletMap, { type MapMarker, type MapPolyline } from '@/components/maps/leaflet-map'
import { DIAS, ATAJOS_DIAS, labelDias, type DiaSemana } from '@/lib/dias-visita'

const zonaSchema = z.object({
  nombre: z.string().min(2, 'Mínimo 2 caracteres'),
  descripcion: z.string().nullable().optional(),
  referencias: z.string().nullable().optional(),
  activo: z.boolean().default(true),
  radio_km: z.coerce.number().min(0.1).max(50).default(1.5),
  color_hex: z.string().nullable().optional(),
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
  const [ubigeoVal, setUbigeoVal] = useState<UbigeoValue>(UBIGEO_EMPTY)
  const [centro, setCentro] = useState<[number, number] | null>(null)
  const [radioKm, setRadioKm] = useState<number>(1.5)
  const [colorHex, setColorHex] = useState<string>('#2563eb')
  const [clientesEnZona, setClientesEnZona] = useState<any[]>([])
  const [diasVisita, setDiasVisita] = useState<DiaSemana[]>([])
  const [detailClientes, setDetailClientes] = useState<any[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

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
      .select('id, nombre, descripcion, referencias, activo, created_at, ubigeo, departamento, provincia, distrito, centro_lat, centro_lng, radio_km, color_hex, dias_visita', { count: 'exact' })
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
    setUbigeoVal(UBIGEO_EMPTY)
    setCentro(null)
    setRadioKm(1.5)
    setColorHex('#2563eb')
    setClientesEnZona([])
    setDiasVisita(['lun', 'mar', 'mie', 'jue', 'vie'])
    reset({ activo: true, nombre: '', descripcion: '', referencias: '', radio_km: 1.5, color_hex: '#2563eb' })
    setDialogOpen(true)
  }

  const openEdit = async (zona: any) => {
    setEditingZona(zona)
    setActivoVal(zona.activo)
    setUbigeoVal({
      departamento_codigo: zona.ubigeo ? zona.ubigeo.slice(0, 2) : null,
      departamento: zona.departamento ?? null,
      provincia_codigo: zona.ubigeo ? zona.ubigeo.slice(2, 4) : null,
      provincia: zona.provincia ?? null,
      distrito_codigo: zona.ubigeo ? zona.ubigeo.slice(4, 6) : null,
      distrito: zona.distrito ?? null,
      ubigeo: zona.ubigeo ?? null,
    })
    setCentro(zona.centro_lat != null && zona.centro_lng != null ? [Number(zona.centro_lat), Number(zona.centro_lng)] : null)
    setRadioKm(Number(zona.radio_km ?? 1.5))
    setColorHex(zona.color_hex ?? '#2563eb')
    setDiasVisita((zona.dias_visita ?? []) as DiaSemana[])
    reset({
      nombre: zona.nombre,
      descripcion: zona.descripcion ?? '',
      referencias: zona.referencias ?? '',
      activo: zona.activo,
      radio_km: Number(zona.radio_km ?? 1.5),
      color_hex: zona.color_hex ?? '#2563eb',
    })
    // Cargar clientes asignados a esta zona para el preview
    const { data: cs } = await (supabase as any)
      .from('clientes')
      .select('id, razon_social, latitud, longitud')
      .eq('zona_id', zona.id)
      .eq('estado', 'activo')
    setClientesEnZona(cs ?? [])
    setDialogOpen(true)
  }

  const openDetail = async (z: any) => {
    setSelected(z)
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailClientes([])
    // Traer clientes con sus direcciones (las extra de cliente_direcciones + la principal)
    const { data: cs } = await (supabase as any)
      .from('clientes')
      .select('id, razon_social, ruc, dni, telefono, direccion, latitud, longitud, dias_visita, estado')
      .eq('zona_id', z.id)
      .eq('estado', 'activo')
      .order('razon_social')
    // Traer direcciones extra de los clientes
    const ids = (cs ?? []).map((c: any) => c.id)
    let direccionesMap: Record<string, any[]> = {}
    if (ids.length > 0) {
      const { data: dirs } = await (supabase as any)
        .from('cliente_direcciones')
        .select('cliente_id, nombre, direccion, latitud, longitud, es_principal')
        .in('cliente_id', ids)
        .eq('activo', true)
      ;(dirs ?? []).forEach((d: any) => {
        if (!direccionesMap[d.cliente_id]) direccionesMap[d.cliente_id] = []
        direccionesMap[d.cliente_id].push(d)
      })
    }
    const enriquecidos = (cs ?? []).map((c: any) => ({
      ...c,
      direcciones_extra: direccionesMap[c.id] ?? [],
    }))
    setDetailClientes(enriquecidos)
    setDetailLoading(false)
  }

  const onSubmit = async (data: ZonaFormData) => {
    setSaving(true)
    try {
      const payload: any = {
        nombre: data.nombre,
        descripcion: data.descripcion || null,
        referencias: data.referencias || null,
        activo: activoVal,
        ubigeo: ubigeoVal.ubigeo,
        departamento: ubigeoVal.departamento,
        provincia: ubigeoVal.provincia,
        distrito: ubigeoVal.distrito,
        centro_lat: centro ? centro[0] : null,
        centro_lng: centro ? centro[1] : null,
        radio_km: data.radio_km ?? null,
        color_hex: colorHex,
        dias_visita: diasVisita,
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
                  {(z.distrito || z.provincia || z.departamento) && (
                    <p className="text-xs text-gray-500 mt-1">
                      {[z.distrito, z.provincia, z.departamento].filter(Boolean).join(' - ')}
                    </p>
                  )}
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
                      {['Zona', 'Días de Visita', 'Clientes', 'Estado', 'Acciones'].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {zonas.map((z) => (
                      <tr key={z.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-gray-800">{z.nombre}</div>
                          {(z.distrito || z.provincia || z.departamento) && (
                            <div className="text-xs text-gray-500">
                              {[z.distrito, z.provincia, z.departamento].filter(Boolean).join(' - ')}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                            📅 {labelDias(z.dias_visita)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-600 font-semibold">{clientesPorZona[z.id] ?? 0}</td>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingZona ? 'Editar Zona' : 'Nueva Zona'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Label>Nombre de la Zona *</Label>
                <Input {...register('nombre')} placeholder="Ej. Zona Norte, Cercado, Pocollay..." className="mt-1" />
                {errors.nombre && <p className="text-xs text-red-500 mt-1">{errors.nombre.message}</p>}
              </div>
              <div>
                <Label>Color</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    value={colorHex}
                    onChange={(e) => setColorHex(e.target.value)}
                    className="w-10 h-9 rounded cursor-pointer border border-gray-200"
                  />
                  <Input value={colorHex} onChange={(e) => setColorHex(e.target.value)} className="font-mono text-xs" maxLength={7} />
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-gray-700">Ubicación administrativa</Label>
              <div className="mt-1">
                <UbigeoSelector value={ubigeoVal} onChange={setUbigeoVal} layout="columns" showLabels />
              </div>
            </div>

            <div>
              <Label>Descripción</Label>
              <Textarea
                {...register('descripcion')}
                placeholder="Descripción del área geográfica o cobertura de la zona..."
                className="mt-1 resize-none"
                rows={2}
              />
            </div>

            <div>
              <Label>Referencias (calles, landmarks, límites)</Label>
              <Textarea
                {...register('referencias')}
                placeholder="Ej: Desde Av. Bolognesi hasta Av. San Martín, incluye Parque 7 de Junio..."
                className="mt-1 resize-none"
                rows={2}
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Pistas textuales para identificar la zona rápidamente (calles principales, puntos de referencia).
              </p>
            </div>

            {/* Cobertura geográfica */}
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <Label className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-gray-500" />
                    Cobertura geográfica
                  </Label>
                  <p className="text-[11px] text-gray-400">Haz clic en el mapa para fijar el centro. Ajusta el radio para cubrir la zona.</p>
                </div>
                {centro && (
                  <button type="button" onClick={() => setCentro(null)} className="text-xs text-red-600 hover:underline">Quitar</button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 mb-2">
                <div className="col-span-2">
                  <Label className="text-[11px] text-gray-500">Radio: {radioKm.toFixed(1)} km</Label>
                  <input
                    type="range"
                    min={0.2}
                    max={10}
                    step={0.1}
                    value={radioKm}
                    onChange={(e) => setRadioKm(Number(e.target.value))}
                    className="w-full accent-yellow-400 mt-1"
                  />
                  <input type="hidden" {...register('radio_km')} value={radioKm} />
                </div>
                <div className="text-center bg-blue-50 rounded-lg p-2">
                  <p className="text-[10px] text-blue-700 font-semibold uppercase">Clientes dentro</p>
                  <p className="text-lg font-bold text-blue-900">
                    {centro ? contarClientesDentro(centro, radioKm, clientesEnZona) : '—'}
                  </p>
                </div>
              </div>

              <LeafletMap
                height="280px"
                pickable
                pickedPosition={centro}
                onPick={(lat, lng) => setCentro([lat, lng])}
                fitBounds={!!centro}
                markers={[
                  ...(centro ? [{ id: 'centro', lat: centro[0], lng: centro[1], label: 'Centro', color: colorHex, initials: '⊕' } as MapMarker] : []),
                  ...clientesEnZona
                    .filter((c) => c.latitud != null && c.longitud != null)
                    .map((c) => ({
                      id: c.id, lat: Number(c.latitud), lng: Number(c.longitud),
                      label: c.razon_social,
                      color: centro && distanciaKmSimple(centro, [Number(c.latitud), Number(c.longitud)]) <= radioKm ? '#16a34a' : '#9ca3af',
                    } as MapMarker)),
                ]}
                polylines={centro ? [{
                  id: 'radio',
                  positions: generarCirculo(centro, radioKm),
                  color: colorHex,
                  dashed: true,
                }] : []}
              />
            </div>

            {/* Días de visita */}
            <div>
              <Label className="text-sm font-semibold">Días de visita default</Label>
              <p className="text-[11px] text-gray-500 mb-2">
                Los clientes de esta zona se visitarán estos días por defecto. Cada cliente puede personalizar si lo necesita.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DIAS.map((d) => {
                  const activo = diasVisita.includes(d.key)
                  return (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => setDiasVisita((prev) => activo ? prev.filter((x) => x !== d.key) : [...prev, d.key])}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        activo
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                      title={d.label}
                    >
                      {d.label.slice(0, 3)}
                    </button>
                  )
                })}
              </div>
              <div className="flex gap-1.5 mt-2">
                {Object.entries(ATAJOS_DIAS).map(([nombre, dias]) => (
                  <button
                    key={nombre}
                    type="button"
                    onClick={() => setDiasVisita(dias)}
                    className="text-[11px] text-blue-600 hover:underline"
                  >
                    {nombre}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDiasVisita([])}
                  className="text-[11px] text-gray-500 hover:underline ml-auto"
                >
                  Limpiar
                </button>
              </div>
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle de la Zona</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              {/* Header */}
              <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-bold"
                  style={{ background: selected.color_hex ?? '#2563eb' }}
                >
                  {selected.nombre?.[0] ?? 'Z'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 truncate">{selected.nombre}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                      📅 {labelDias(selected.dias_visita)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {detailClientes.length} {detailClientes.length === 1 ? 'cliente' : 'clientes'}
                    </span>
                  </div>
                </div>
                {selected.activo
                  ? <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Activa</Badge>
                  : <Badge variant="secondary" className="text-xs">Inactiva</Badge>}
              </div>

              {selected.descripcion && (
                <p className="text-sm text-gray-600 italic">{selected.descripcion}</p>
              )}

              {/* Mapa con puntos de los clientes */}
              {(() => {
                const markers: MapMarker[] = detailClientes
                  .flatMap((c: any) => {
                    const todas = [
                      ...(c.latitud != null && c.longitud != null
                        ? [{ lat: Number(c.latitud), lng: Number(c.longitud), label: c.razon_social, principal: true }]
                        : []),
                      ...(c.direcciones_extra ?? [])
                        .filter((d: any) => d.latitud != null && d.longitud != null)
                        .map((d: any) => ({ lat: Number(d.latitud), lng: Number(d.longitud), label: `${c.razon_social} · ${d.nombre}`, principal: false })),
                    ]
                    return todas
                  })
                  .map((p: any, i: number) => ({
                    id: `cli-${i}`,
                    lat: p.lat,
                    lng: p.lng,
                    color: p.principal ? (selected.color_hex ?? '#2563eb') : '#9ca3af',
                    label: p.label,
                  }))

                if (markers.length === 0) {
                  return (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-6 text-center text-sm text-gray-500">
                      Ningún cliente con dirección georreferenciada en esta zona.
                    </div>
                  )
                }

                // Calcular centro y zoom basados en los markers
                const lats = markers.map((m) => m.lat)
                const lngs = markers.map((m) => m.lng)
                const centroAuto: [number, number] = [
                  (Math.min(...lats) + Math.max(...lats)) / 2,
                  (Math.min(...lngs) + Math.max(...lngs)) / 2,
                ]

                return (
                  <div className="h-72 border border-gray-200 rounded-lg overflow-hidden">
                    <LeafletMap
                      center={centroAuto}
                      zoom={13}
                      markers={markers}
                    />
                  </div>
                )
              })()}

              {/* Lista de clientes */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Clientes de la zona</h4>
                {detailLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </div>
                ) : detailClientes.length === 0 ? (
                  <p className="text-sm text-gray-500 italic py-3">No hay clientes asignados a esta zona aún.</p>
                ) : (
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
                    {detailClientes.map((c: any) => {
                      const diasEfectivos = (c.dias_visita && c.dias_visita.length > 0) ? c.dias_visita : (selected.dias_visita ?? [])
                      const heredado = !c.dias_visita || c.dias_visita.length === 0
                      return (
                        <div key={c.id} className="p-3 hover:bg-gray-50/50">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-gray-900 text-sm truncate">{c.razon_social}</p>
                              <p className="text-[11px] text-gray-500 font-mono">
                                {c.ruc ? `RUC ${c.ruc}` : c.dni ? `DNI ${c.dni}` : 'Sin doc.'}
                              </p>
                              {c.direccion && (
                                <p className="text-xs text-gray-600 mt-1 flex items-start gap-1">
                                  <MapPin className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" />
                                  <span>{c.direccion}</span>
                                </p>
                              )}
                              {(c.direcciones_extra ?? []).map((d: any) => (
                                <p key={d.nombre} className="text-xs text-gray-500 mt-0.5 flex items-start gap-1 ml-4">
                                  <span className="text-[10px] text-gray-400">↳</span>
                                  <span><span className="font-medium">{d.nombre}:</span> {d.direccion}</span>
                                </p>
                              ))}
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                heredado ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                              }`} title={heredado ? 'Heredados de la zona' : 'Días personalizados del cliente'}>
                                📅 {labelDias(diasEfectivos)}
                              </span>
                              {!heredado && <span className="text-[10px] text-amber-600">Personalizados</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-3 border-t border-gray-100">
                <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>
                <Button onClick={() => { setDetailOpen(false); openEdit(selected) }} className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2">
                  <Edit className="w-4 h-4" /> Editar zona
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Helpers geo ─────────────────────────────────────────────────────────────
function distanciaKmSimple(a: [number, number], b: [number, number]): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

function generarCirculo(centro: [number, number], radioKm: number, puntos = 36): [number, number][] {
  const [lat, lng] = centro
  // Aproximación: 1° latitud ≈ 111 km, 1° longitud ≈ 111 × cos(lat) km
  const dLat = radioKm / 111
  const dLng = radioKm / (111 * Math.cos((lat * Math.PI) / 180))
  const coords: [number, number][] = []
  for (let i = 0; i <= puntos; i++) {
    const theta = (i / puntos) * 2 * Math.PI
    coords.push([lat + dLat * Math.sin(theta), lng + dLng * Math.cos(theta)])
  }
  return coords
}

function contarClientesDentro(centro: [number, number], radioKm: number, clientes: any[]): number {
  return clientes.filter((c) => {
    if (c.latitud == null || c.longitud == null) return false
    return distanciaKmSimple(centro, [Number(c.latitud), Number(c.longitud)]) <= radioKm
  }).length
}
