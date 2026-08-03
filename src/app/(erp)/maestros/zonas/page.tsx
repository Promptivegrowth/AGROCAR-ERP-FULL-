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
  const [centroAprox, setCentroAprox] = useState(false)
  const [coordPegar, setCoordPegar] = useState('')
  const [radioKm, setRadioKm] = useState<number>(1.5)
  const [colorHex, setColorHex] = useState<string>('#2563eb')
  const [clientesEnZona, setClientesEnZona] = useState<any[]>([])
  const [diasVisita, setDiasVisita] = useState<DiaSemana[]>([])
  const [detailClientes, setDetailClientes] = useState<any[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [mapFlyTo, setMapFlyTo] = useState<{ lat: number; lng: number; zoom: number; key: number } | null>(null)
  // Para el editor: lista completa de clientes y cuáles están asignados
  const [todosClientes, setTodosClientes] = useState<any[]>([])
  const [clientesAsignados, setClientesAsignados] = useState<Set<string>>(new Set())
  const [clienteSearch, setClienteSearch] = useState('')

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
      .select('id, nombre, descripcion, referencias, activo, created_at, ubigeo, departamento, provincia, distrito, centro_lat, centro_lng, centro_aproximado, radio_km, color_hex, dias_visita', { count: 'exact' })
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

  const openCreate = async () => {
    setEditingZona(null)
    setActivoVal(true)
    setUbigeoVal(UBIGEO_EMPTY)
    setCentro(null)
    setCentroAprox(false)
    setCoordPegar('')
    setRadioKm(1.5)
    setColorHex('#2563eb')
    setClientesEnZona([])
    setDiasVisita(['lun', 'mar', 'mie', 'jue', 'vie'])
    setClientesAsignados(new Set())
    setClienteSearch('')
    // Cargar todos los clientes para poder asignarlos a la nueva zona
    const { data: all } = await (supabase as any)
      .from('clientes')
      .select('id, razon_social, ruc, dni, direccion, zona_id, latitud, longitud')
      .eq('estado', 'activo')
      .order('razon_social')
    setTodosClientes(all ?? [])
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
    setCentroAprox(!!zona.centro_aproximado)
    setCoordPegar('')
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
    // Cargar TODOS los clientes activos y marcar los asignados a esta zona
    const { data: all } = await (supabase as any)
      .from('clientes')
      .select('id, razon_social, ruc, dni, direccion, zona_id, latitud, longitud')
      .eq('estado', 'activo')
      .order('razon_social')
    setTodosClientes(all ?? [])
    setClientesAsignados(new Set((all ?? []).filter((c: any) => c.zona_id === zona.id).map((c: any) => c.id)))
    setClientesEnZona((all ?? []).filter((c: any) => c.zona_id === zona.id))
    setClienteSearch('')
    setDialogOpen(true)
  }

  const openDetail = async (z: any) => {
    setSelected(z)
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailClientes([])

    // 1) Clientes cuya zona principal es esta
    const { data: cs } = await (supabase as any)
      .from('clientes')
      .select('id, razon_social, ruc, dni, telefono, direccion, latitud, longitud, dias_visita, estado, zona_id')
      .eq('zona_id', z.id)
      .eq('estado', 'activo')
      .order('razon_social')

    // 2) Direcciones cuyo zona_id override apunta a esta zona (sucursal en otra zona)
    const { data: dirsDeEstaZona } = await (supabase as any)
      .from('cliente_direcciones')
      .select('cliente_id, nombre, direccion, latitud, longitud, es_principal, zona_id, clientes(id, razon_social, ruc, dni, telefono, direccion, latitud, longitud, dias_visita, zona_id)')
      .eq('zona_id', z.id)
      .eq('activo', true)

    // Merge: clientes primarios + clientes que tienen al menos una sucursal en esta zona
    const idsPrimarios = new Set((cs ?? []).map((c: any) => c.id))
    const externos: any[] = []
    ;(dirsDeEstaZona ?? []).forEach((d: any) => {
      const cli = d.clientes
      if (cli && !idsPrimarios.has(cli.id)) {
        externos.push({ ...cli, _direccion_sucursal: { nombre: d.nombre, direccion: d.direccion, latitud: d.latitud, longitud: d.longitud } })
      }
    })

    // Traer TODAS las direcciones extra de todos los clientes
    const ids = [...(cs ?? []).map((c: any) => c.id), ...externos.map((c: any) => c.id)]
    let direccionesMap: Record<string, any[]> = {}
    if (ids.length > 0) {
      const { data: dirs } = await (supabase as any)
        .from('cliente_direcciones')
        .select('cliente_id, nombre, direccion, latitud, longitud, es_principal, zona_id')
        .in('cliente_id', ids)
        .eq('activo', true)
      ;(dirs ?? []).forEach((d: any) => {
        if (!direccionesMap[d.cliente_id]) direccionesMap[d.cliente_id] = []
        direccionesMap[d.cliente_id].push(d)
      })
    }
    const enriquecidos = [
      ...(cs ?? []).map((c: any) => ({ ...c, direcciones_extra: direccionesMap[c.id] ?? [], _es_externo: false })),
      ...externos.map((c: any) => ({ ...c, direcciones_extra: direccionesMap[c.id] ?? [], _es_externo: true })),
    ]
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
        // Si alguien la ubicó a mano deja de ser aproximada
        centro_aproximado: centro ? centroAprox : false,
        radio_km: data.radio_km ?? null,
        color_hex: colorHex,
        dias_visita: diasVisita,
      }

      let zonaId: string | null = editingZona?.id ?? null
      if (editingZona) {
        const { error } = await (supabase.from('zonas') as any)
          .update(payload)
          .eq('id', editingZona.id)
        if (error) throw error
      } else {
        const { data: nueva, error } = await (supabase.from('zonas') as any).insert(payload).select('id').single()
        if (error || !nueva) throw error ?? new Error('No se pudo crear la zona')
        zonaId = nueva.id
      }

      // Sincronizar clientes asignados ↔ desasignados
      if (zonaId) {
        const yaAsignados = new Set(todosClientes.filter((c: any) => c.zona_id === zonaId).map((c: any) => c.id))
        const aAsignar: string[] = []
        const aQuitar: string[] = []
        todosClientes.forEach((c: any) => {
          const debeEstar = clientesAsignados.has(c.id)
          const estaba = yaAsignados.has(c.id)
          if (debeEstar && !estaba) aAsignar.push(c.id)
          else if (!debeEstar && estaba) aQuitar.push(c.id)
        })
        if (aAsignar.length > 0) {
          await (supabase.from('clientes') as any).update({ zona_id: zonaId }).in('id', aAsignar)
        }
        if (aQuitar.length > 0) {
          await (supabase.from('clientes') as any).update({ zona_id: null }).in('id', aQuitar)
        }
      }

      const accion = editingZona ? 'actualizada' : 'creada'
      toast.success(`Zona ${accion}`, {
        description: `${data.nombre} · ${clientesAsignados.size} ${clientesAsignados.size === 1 ? 'cliente asignado' : 'clientes asignados'}`,
      })

      setDialogOpen(false)
      loadZonas()
      loadClientesPorZona()
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

            {/* Centro de la zona: alimenta el mapa del análisis zonificado */}
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/60">
              <Label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-gray-500" />
                Centro de la zona en el mapa
              </Label>
              <p className="text-[11px] text-gray-500 mt-0.5 mb-2">
                Es el punto donde esta zona aparece en el <b>Análisis zonificado</b>.
                Ábrela en Google Maps, haz clic derecho sobre el lugar, copia las coordenadas y pégalas aquí.
              </p>

              <div className="flex gap-2">
                <Input
                  value={coordPegar}
                  onChange={(e) => setCoordPegar(e.target.value)}
                  onPaste={(e) => {
                    const txt = e.clipboardData.getData('text')
                    if (parsearCoordenadas(txt)) {
                      e.preventDefault()
                      setCoordPegar(txt)
                      const c = parsearCoordenadas(txt)!
                      setCentro(c)
                      setCentroAprox(false)
                      toast.success('Coordenadas reconocidas', {
                        description: `${c[0].toFixed(6)}, ${c[1].toFixed(6)}`,
                      })
                    }
                  }}
                  placeholder="-18.014600, -70.253600  ·  o pega el enlace de Google Maps"
                  className="h-9 text-xs font-mono flex-1"
                />
                <Button type="button" variant="outline" size="sm" className="h-9"
                  onClick={() => {
                    const c = parsearCoordenadas(coordPegar)
                    if (!c) {
                      toast.error('No pude leer esas coordenadas', {
                        description: 'Usa el formato -18.0146, -70.2536 o pega el enlace de Google Maps.',
                      })
                      return
                    }
                    setCentro(c)
                    setCentroAprox(false)
                    toast.success('Ubicación fijada', { description: `${c[0].toFixed(6)}, ${c[1].toFixed(6)}` })
                  }}>
                  Fijar
                </Button>
              </div>

              <div className="flex items-center gap-2 mt-2 text-[11px]">
                {centro ? (
                  <>
                    <span className="font-mono text-gray-700">
                      {centro[0].toFixed(6)}, {centro[1].toFixed(6)}
                    </span>
                    {centroAprox && (
                      <span className="text-amber-800 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5 font-semibold">
                        Aproximada — conviene afinarla
                      </span>
                    )}
                    <a
                      href={`https://www.google.com/maps?q=${centro[0]},${centro[1]}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 underline"
                    >
                      Ver en Google Maps
                    </a>
                    <button type="button" onClick={() => { setCentro(null); setCoordPegar('') }}
                      className="text-red-600 underline ml-auto">
                      Quitar
                    </button>
                  </>
                ) : (
                  <span className="text-gray-400">Sin ubicación — esta zona no saldrá en el mapa</span>
                )}
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

            {/* Clientes asignados a la zona */}
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <div>
                  <Label className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-gray-500" />
                    Clientes asignados
                  </Label>
                  <p className="text-[11px] text-gray-400">
                    Marca los clientes que pertenecen a esta zona. Un cliente solo puede estar en una zona principal a la vez.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1">
                    {clientesAsignados.size} de {todosClientes.length}
                  </span>
                </div>
              </div>

              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                  value={clienteSearch}
                  onChange={(e) => setClienteSearch(e.target.value)}
                  placeholder="Buscar cliente por nombre, RUC o DNI..."
                  className="pl-8 h-8 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 mt-2 mb-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    const q = clienteSearch.toLowerCase().trim()
                    const visibles = todosClientes
                      .filter((c: any) => {
                        if (!q) return true
                        return c.razon_social.toLowerCase().includes(q) ||
                          (c.ruc ?? '').toLowerCase().includes(q) ||
                          (c.dni ?? '').toLowerCase().includes(q)
                      })
                      .map((c: any) => c.id)
                    setClientesAsignados((prev) => {
                      const next = new Set(prev)
                      visibles.forEach((id) => next.add(id))
                      return next
                    })
                  }}
                  className="text-blue-600 hover:underline"
                >
                  Seleccionar visibles
                </button>
                <span className="text-gray-300">·</span>
                <button
                  type="button"
                  onClick={() => {
                    const q = clienteSearch.toLowerCase().trim()
                    const visibles = todosClientes
                      .filter((c: any) => {
                        if (!q) return true
                        return c.razon_social.toLowerCase().includes(q) ||
                          (c.ruc ?? '').toLowerCase().includes(q) ||
                          (c.dni ?? '').toLowerCase().includes(q)
                      })
                      .map((c: any) => c.id)
                    setClientesAsignados((prev) => {
                      const next = new Set(prev)
                      visibles.forEach((id) => next.delete(id))
                      return next
                    })
                  }}
                  className="text-gray-500 hover:underline"
                >
                  Limpiar visibles
                </button>
              </div>

              <div className="border border-gray-200 rounded-lg max-h-72 overflow-y-auto divide-y divide-gray-100">
                {(() => {
                  const q = clienteSearch.toLowerCase().trim()
                  const filtrados = todosClientes.filter((c: any) => {
                    if (!q) return true
                    return c.razon_social.toLowerCase().includes(q) ||
                      (c.ruc ?? '').toLowerCase().includes(q) ||
                      (c.dni ?? '').toLowerCase().includes(q)
                  })
                  if (filtrados.length === 0) {
                    return <div className="p-4 text-center text-xs text-gray-400 italic">Sin clientes</div>
                  }
                  // Asignados primero
                  filtrados.sort((a: any, b: any) => {
                    const aSel = clientesAsignados.has(a.id) ? 0 : 1
                    const bSel = clientesAsignados.has(b.id) ? 0 : 1
                    if (aSel !== bSel) return aSel - bSel
                    return a.razon_social.localeCompare(b.razon_social)
                  })
                  return filtrados.slice(0, 200).map((c: any) => {
                    const seleccionado = clientesAsignados.has(c.id)
                    const enOtraZona = c.zona_id && c.zona_id !== editingZona?.id
                    return (
                      <label
                        key={c.id}
                        className={`flex items-start gap-2 px-3 py-2 cursor-pointer ${seleccionado ? 'bg-green-50/50' : 'hover:bg-gray-50/50'}`}
                      >
                        <input
                          type="checkbox"
                          checked={seleccionado}
                          onChange={() => {
                            setClientesAsignados((prev) => {
                              const next = new Set(prev)
                              if (next.has(c.id)) next.delete(c.id); else next.add(c.id)
                              return next
                            })
                          }}
                          className="mt-1 accent-green-600"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-900 truncate">
                            {c.razon_social}
                            {enOtraZona && !seleccionado && (
                              <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                Ya está en otra zona
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-gray-500 font-mono">
                            {c.ruc ? `RUC ${c.ruc}` : c.dni ? `DNI ${c.dni}` : 'Sin doc.'}
                            {c.direccion && <span className="ml-2 text-gray-400">{c.direccion}</span>}
                          </p>
                        </div>
                      </label>
                    )
                  })
                })()}
                {(() => {
                  const q = clienteSearch.toLowerCase().trim()
                  const totalFiltrados = todosClientes.filter((c: any) => {
                    if (!q) return true
                    return c.razon_social.toLowerCase().includes(q) ||
                      (c.ruc ?? '').toLowerCase().includes(q) ||
                      (c.dni ?? '').toLowerCase().includes(q)
                  }).length
                  if (totalFiltrados > 200) {
                    return (
                      <div className="px-3 py-2 text-[10px] text-gray-400 text-center bg-gray-50">
                        Mostrando 200 de {totalFiltrados}. Refina la búsqueda.
                      </div>
                    )
                  }
                  return null
                })()}
              </div>
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
      <Dialog open={detailOpen} onOpenChange={(o) => { setDetailOpen(o); if (!o) setMapFlyTo(null) }}>
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
                  <div className="h-80 border border-gray-200 rounded-lg overflow-hidden relative">
                    <LeafletMap
                      center={centroAuto}
                      zoom={13}
                      markers={markers}
                      flyTo={mapFlyTo}
                    />
                    {/* Leyenda */}
                    <div className="absolute bottom-2 left-2 bg-white/95 border border-gray-200 rounded shadow-sm px-2 py-1 text-[10px] z-[1000]">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: selected.color_hex ?? '#2563eb' }} />
                        <span>Dirección principal</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-gray-400" />
                        <span>Sucursal/extra</span>
                      </div>
                    </div>
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
                      const tieneCoords = c.latitud != null && c.longitud != null
                      const tieneCoordExtra = (c.direcciones_extra ?? []).some((d: any) => d.latitud != null && d.longitud != null)
                      const clickeable = tieneCoords || tieneCoordExtra
                      return (
                        <div
                          key={c.id}
                          className={`p-3 transition-colors ${clickeable ? 'hover:bg-blue-50 cursor-pointer' : 'hover:bg-gray-50/50'}`}
                          onClick={() => {
                            if (tieneCoords) {
                              setMapFlyTo({ lat: Number(c.latitud), lng: Number(c.longitud), zoom: 17, key: Date.now() })
                            } else if (tieneCoordExtra) {
                              const d = (c.direcciones_extra ?? []).find((d: any) => d.latitud != null && d.longitud != null)
                              if (d) setMapFlyTo({ lat: Number(d.latitud), lng: Number(d.longitud), zoom: 17, key: Date.now() })
                            }
                          }}
                          title={clickeable ? 'Click para centrar en el mapa' : 'Sin coordenadas registradas'}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-gray-900 text-sm truncate flex items-center gap-1.5">
                                {clickeable && <span className="text-blue-500 text-xs">📍</span>}
                                {c.razon_social}
                              </p>
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
                                <button
                                  key={d.nombre}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (d.latitud != null && d.longitud != null) {
                                      setMapFlyTo({ lat: Number(d.latitud), lng: Number(d.longitud), zoom: 17, key: Date.now() })
                                    }
                                  }}
                                  className="text-xs text-gray-500 mt-0.5 flex items-start gap-1 ml-4 text-left hover:text-blue-700"
                                >
                                  <span className="text-[10px] text-gray-400">↳</span>
                                  <span><span className="font-medium">{d.nombre}:</span> {d.direccion}</span>
                                </button>
                              ))}
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                heredado ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                              }`} title={heredado ? 'Heredados de la zona' : 'Días personalizados del cliente'}>
                                📅 {labelDias(diasEfectivos)}
                              </span>
                              {!heredado && <span className="text-[10px] text-amber-600">Personalizados</span>}
                              {!clickeable && <span className="text-[9px] text-gray-400 italic">sin GPS</span>}
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

/**
 * Lee coordenadas de lo que sea que peguen: el par suelto que copia Google
 * Maps con clic derecho, o el enlace completo del navegador.
 * Acepta "-18.0146, -70.2536", "-18.0146 -70.2536",
 * ".../@-18.0146,-70.2536,17z" y "...?q=-18.0146,-70.2536".
 */
function parsearCoordenadas(texto: string): [number, number] | null {
  if (!texto) return null
  const t = texto.trim()

  // Enlaces de Google Maps: @lat,lng  ·  q=lat,lng  ·  !3dlat!4dlng
  const patrones = [
    /@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /[?&]q=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
  ]
  for (const re of patrones) {
    const m = t.match(re)
    if (m) {
      const lat = parseFloat(m[1]); const lng = parseFloat(m[2])
      if (esCoordValida(lat, lng)) return [lat, lng]
    }
  }

  // Par suelto separado por coma, punto y coma o espacios
  const m = t.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/)
  if (m) {
    const lat = parseFloat(m[1]); const lng = parseFloat(m[2])
    if (esCoordValida(lat, lng)) return [lat, lng]
  }
  return null
}

function esCoordValida(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0)
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
