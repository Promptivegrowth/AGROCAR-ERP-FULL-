'use client'

// NOTA: Esta página solo debe ser accesible para roles 'gerente' y 'administrador'.
// El guard de autorización se resuelve en el layout de (erp); aquí no se revalida el rol.

import { useEffect, useState, useCallback } from 'react'
import {
  Loader2, Eye, CheckCircle, XCircle, Clock, MapPin, Phone, Mail,
  User as UserIcon, UserPlus, Inbox, Calendar,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import LeafletMap from '@/components/maps/leaflet-map'
import { formatDate } from '@/lib/utils'

type EstadoSolicitud = 'pendiente' | 'aprobada' | 'rechazada'
type TipoCliente = 'consumidor_final' | 'tienda'

interface SolicitudRow {
  id: string
  vendedor_id: string
  razon_social: string
  ruc: string | null
  dni: string | null
  tipo_cliente: TipoCliente
  direccion: string | null
  telefono: string | null
  email: string | null
  contacto: string | null
  zona_id: string | null
  ubigeo: string | null
  departamento: string | null
  provincia: string | null
  distrito: string | null
  latitud: number | null
  longitud: number | null
  notas: string | null
  estado: EstadoSolicitud
  razon_rechazo: string | null
  cliente_id: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  profiles?: { id: string; full_name: string | null } | null
  zonas?: { id: string; nombre: string } | null
}

const ESTADO_CONFIG: Record<EstadoSolicitud, { label: string; className: string; Icon: any }> = {
  pendiente:  { label: 'Pendiente',  className: 'bg-amber-100 text-amber-700 border-amber-200', Icon: Clock },
  aprobada:   { label: 'Aprobada',   className: 'bg-green-100 text-green-700 border-green-200', Icon: CheckCircle },
  rechazada:  { label: 'Rechazada',  className: 'bg-red-100 text-red-700 border-red-200',       Icon: XCircle },
}

export default function SolicitudesClientePage() {
  const supabase = createClient()

  const [solicitudes, setSolicitudes] = useState<SolicitudRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<EstadoSolicitud | 'todas'>('pendiente')
  const [processingId, setProcessingId] = useState<string | null>(null)

  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<SolicitudRow | null>(null)

  const [counts, setCounts] = useState({ pendiente: 0, aprobada: 0, rechazada: 0, todas: 0 })

  const loadSolicitudes = useCallback(async () => {
    setLoading(true)
    let query: any = (supabase.from('solicitudes_cliente' as any) as any)
      .select(`
        id, vendedor_id, razon_social, ruc, dni, tipo_cliente, direccion, telefono, email, contacto,
        zona_id, ubigeo, departamento, provincia, distrito,
        latitud, longitud, notas, estado, razon_rechazo, cliente_id, reviewed_by, reviewed_at, created_at,
        profiles!solicitudes_cliente_vendedor_id_fkey(id, full_name),
        zonas(id, nombre)
      `)
      .order('created_at', { ascending: false })

    if (filter !== 'todas') query = query.eq('estado', filter)

    const { data, error } = await query
    if (error) toast.error('Error al cargar solicitudes', { description: error.message })
    setSolicitudes((data ?? []) as unknown as SolicitudRow[])
    setLoading(false)
  }, [filter])

  const loadCounts = useCallback(async () => {
    const { data } = await (supabase.from('solicitudes_cliente' as any) as any)
      .select('estado')
    const next = { pendiente: 0, aprobada: 0, rechazada: 0, todas: 0 }
    ;(data ?? []).forEach((r: any) => {
      next.todas += 1
      if (r.estado === 'pendiente') next.pendiente += 1
      else if (r.estado === 'aprobada') next.aprobada += 1
      else if (r.estado === 'rechazada') next.rechazada += 1
    })
    setCounts(next)
  }, [])

  useEffect(() => { loadSolicitudes() }, [loadSolicitudes])
  useEffect(() => { loadCounts() }, [loadCounts])

  const abrirDetalle = (s: SolicitudRow) => { setSelected(s); setDetailOpen(true) }

  const aprobar = async (s: SolicitudRow) => {
    if (processingId) return
    setProcessingId(s.id)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sesión expirada')

      const codigo = `CLI-${String(Date.now()).slice(-6)}`

      const clientePayload: any = {
        codigo,
        razon_social: s.razon_social,
        ruc: s.ruc,
        dni: s.dni,
        tipo_cliente: s.tipo_cliente,
        direccion: s.direccion,
        telefono: s.telefono,
        email: s.email,
        contacto: s.contacto,
        zona_id: s.zona_id,
        vendedor_id: s.vendedor_id,
        ubigeo: s.ubigeo,
        departamento: s.departamento,
        provincia: s.provincia,
        distrito: s.distrito,
        latitud: s.latitud,
        longitud: s.longitud,
        notas: s.notas,
        estado: 'activo',
      }

      const { data: cliente, error: errCli } = await (supabase.from('clientes') as any)
        .insert(clientePayload)
        .select('id')
        .single()
      if (errCli) throw errCli

      const { error: errSol } = await (supabase.from('solicitudes_cliente' as any) as any)
        .update({
          estado: 'aprobada',
          cliente_id: cliente.id,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', s.id)
      if (errSol) throw errSol

      toast.success('Solicitud aprobada', {
        description: `${s.razon_social} registrado como ${codigo}.`,
      })
      setDetailOpen(false)
      await Promise.all([loadSolicitudes(), loadCounts()])
    } catch (err: any) {
      toast.error('No se pudo aprobar', { description: err?.message ?? 'Intenta nuevamente.' })
    } finally {
      setProcessingId(null)
    }
  }

  const rechazar = async (s: SolicitudRow) => {
    if (processingId) return
    const razon = window.prompt('Motivo del rechazo:')
    if (razon === null) return
    const razonTrim = razon.trim()
    if (!razonTrim) {
      toast.error('Debes ingresar un motivo de rechazo')
      return
    }

    setProcessingId(s.id)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sesión expirada')

      const { error } = await (supabase.from('solicitudes_cliente' as any) as any)
        .update({
          estado: 'rechazada',
          razon_rechazo: razonTrim,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', s.id)
      if (error) throw error

      toast.success('Solicitud rechazada', { description: s.razon_social })
      setDetailOpen(false)
      await Promise.all([loadSolicitudes(), loadCounts()])
    } catch (err: any) {
      toast.error('No se pudo rechazar', { description: err?.message ?? 'Intenta nuevamente.' })
    } finally {
      setProcessingId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UserPlus className="w-6 h-6 text-green-600" />
            Solicitudes de Cliente
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {counts.pendiente} pendientes de revisión · {counts.todas} en total
          </p>
        </div>
      </div>

      {/* Tabs de filtro */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
        <TabsList className="h-10">
          <TabsTrigger value="pendiente" className="gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Pendientes
            {counts.pendiente > 0 && (
              <span className="ml-1 bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {counts.pendiente}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="aprobada" className="gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" />
            Aprobadas
          </TabsTrigger>
          <TabsTrigger value="rechazada" className="gap-1.5">
            <XCircle className="w-3.5 h-3.5" />
            Rechazadas
          </TabsTrigger>
          <TabsTrigger value="todas">Todas</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Listado */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
            </div>
          ) : solicitudes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Inbox className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm">No hay solicitudes en esta categoría</p>
            </div>
          ) : (
            <>
              {/* Vista móvil: cards */}
              <div className="md:hidden divide-y divide-gray-50">
                {solicitudes.map((s) => {
                  const cfg = ESTADO_CONFIG[s.estado]
                  return (
                    <div key={s.id} className="p-4 hover:bg-gray-50/50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">{s.razon_social}</p>
                          <p className="text-xs text-gray-500 font-mono">
                            {s.ruc ?? s.dni ?? 'Sin documento'}
                          </p>
                          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                            <UserIcon className="w-3 h-3" />
                            {s.profiles?.full_name ?? 'Vendedor'}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                            <Calendar className="w-3 h-3" />
                            {formatDate(s.created_at)}
                          </div>
                        </div>
                        <Badge className={`text-xs shrink-0 border ${cfg.className}`}>
                          <cfg.Icon className="w-3 h-3 mr-1" />
                          {cfg.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => abrirDetalle(s)} className="h-7 text-xs gap-1">
                          <Eye className="w-3.5 h-3.5" /> Ver Detalle
                        </Button>
                        {s.estado === 'pendiente' && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => aprobar(s)}
                              disabled={processingId === s.id}
                              className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700"
                            >
                              {processingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                              Aprobar
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => rechazar(s)}
                              disabled={processingId === s.id}
                              variant="destructive"
                              className="h-7 text-xs gap-1"
                            >
                              <XCircle className="w-3.5 h-3.5" /> Rechazar
                            </Button>
                          </>
                        )}
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
                      {['Vendedor', 'Razón Social', 'RUC/DNI', 'Dirección', 'Teléfono', 'Zona', 'Fecha', 'Estado', 'Acciones'].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {solicitudes.map((s) => {
                      const cfg = ESTADO_CONFIG[s.estado]
                      return (
                        <tr key={s.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-3 px-4 text-gray-700 text-xs max-w-[160px] truncate">
                            {s.profiles?.full_name ?? '—'}
                          </td>
                          <td className="py-3 px-4 font-medium text-gray-900 max-w-[220px] truncate">{s.razon_social}</td>
                          <td className="py-3 px-4 text-gray-500 font-mono text-xs">{s.ruc ?? s.dni ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs max-w-[200px] truncate">{s.direccion ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs">{s.telefono ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-600 text-xs">{s.zonas?.nombre ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-500 text-xs whitespace-nowrap">{formatDate(s.created_at)}</td>
                          <td className="py-3 px-4">
                            <Badge className={`text-xs border ${cfg.className}`}>
                              <cfg.Icon className="w-3 h-3 mr-1" />
                              {cfg.label}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => abrirDetalle(s)} className="h-7 w-7 p-0" title="Ver detalle">
                                <Eye className="w-3.5 h-3.5 text-gray-500" />
                              </Button>
                              {s.estado === 'pendiente' && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => aprobar(s)}
                                    disabled={processingId === s.id}
                                    className="h-7 w-7 p-0"
                                    title="Aprobar"
                                  >
                                    {processingId === s.id
                                      ? <Loader2 className="w-3.5 h-3.5 animate-spin text-green-600" />
                                      : <CheckCircle className="w-3.5 h-3.5 text-green-600" />}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => rechazar(s)}
                                    disabled={processingId === s.id}
                                    className="h-7 w-7 p-0"
                                    title="Rechazar"
                                  >
                                    <XCircle className="w-3.5 h-3.5 text-red-600" />
                                  </Button>
                                </>
                              )}
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
        </CardContent>
      </Card>

      {/* Modal Detalle */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle de Solicitud</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-gray-100">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{selected.razon_social}</p>
                  <p className="text-xs text-gray-500 font-mono">
                    {selected.ruc ? `RUC: ${selected.ruc}` : selected.dni ? `DNI: ${selected.dni}` : 'Sin documento'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Tipo: {selected.tipo_cliente === 'consumidor_final' ? 'Consumidor final' : 'Tienda'}
                  </p>
                </div>
                <Badge className={`text-xs border ${ESTADO_CONFIG[selected.estado].className}`}>
                  {ESTADO_CONFIG[selected.estado].label}
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="flex items-start gap-2">
                  <UserIcon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">Vendedor</p>
                    <p className="text-gray-800 truncate">{selected.profiles?.full_name ?? '—'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Calendar className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-500">Fecha</p>
                    <p className="text-gray-800">{formatDate(selected.created_at)}</p>
                  </div>
                </div>
                {selected.direccion && (
                  <div className="flex items-start gap-2 sm:col-span-2">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">Dirección</p>
                      <p className="text-gray-800">{selected.direccion}</p>
                    </div>
                  </div>
                )}
                {selected.telefono && (
                  <div className="flex items-start gap-2">
                    <Phone className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Teléfono</p>
                      <p className="text-gray-800">{selected.telefono}</p>
                    </div>
                  </div>
                )}
                {selected.email && (
                  <div className="flex items-start gap-2">
                    <Mail className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">Email</p>
                      <p className="text-gray-800 truncate">{selected.email}</p>
                    </div>
                  </div>
                )}
                {selected.contacto && (
                  <div className="flex items-start gap-2">
                    <UserIcon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Contacto</p>
                      <p className="text-gray-800">{selected.contacto}</p>
                    </div>
                  </div>
                )}
                {selected.zonas?.nombre && (
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Zona</p>
                      <p className="text-gray-800">{selected.zonas.nombre}</p>
                    </div>
                  </div>
                )}
              </div>

              {(selected.distrito || selected.provincia || selected.departamento) && (
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Ubicación administrativa
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-[11px] text-gray-500">Departamento</p>
                      <p className="text-gray-800 text-sm">{selected.departamento ?? '—'}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-[11px] text-gray-500">Provincia</p>
                      <p className="text-gray-800 text-sm">{selected.provincia ?? '—'}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-[11px] text-gray-500">Distrito</p>
                      <p className="text-gray-800 text-sm">{selected.distrito ?? '—'}</p>
                    </div>
                  </div>
                  {selected.ubigeo && (
                    <p className="text-xs text-gray-400 mt-2">Ubigeo {selected.ubigeo}</p>
                  )}
                </div>
              )}

              {selected.notas && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Notas</p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{selected.notas}</p>
                </div>
              )}

              {selected.estado === 'rechazada' && selected.razon_rechazo && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xs text-red-700 font-medium mb-1">Motivo del rechazo</p>
                  <p className="text-sm text-red-800 whitespace-pre-wrap">{selected.razon_rechazo}</p>
                </div>
              )}

              {selected.latitud != null && selected.longitud != null && (
                <div>
                  <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Ubicación
                  </p>
                  <LeafletMap
                    height="240px"
                    markers={[{
                      id: selected.id,
                      lat: Number(selected.latitud),
                      lng: Number(selected.longitud),
                      label: selected.razon_social,
                      description: selected.direccion ?? undefined,
                    }]}
                  />
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-gray-100">
                <Button variant="outline" onClick={() => setDetailOpen(false)}>Cerrar</Button>
                {selected.estado === 'pendiente' && (
                  <>
                    <Button
                      onClick={() => rechazar(selected)}
                      disabled={processingId === selected.id}
                      variant="destructive"
                      className="gap-2"
                    >
                      <XCircle className="w-4 h-4" /> Rechazar
                    </Button>
                    <Button
                      onClick={() => aprobar(selected)}
                      disabled={processingId === selected.id}
                      className="bg-green-600 hover:bg-green-700 gap-2"
                    >
                      {processingId === selected.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                      Aprobar
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
