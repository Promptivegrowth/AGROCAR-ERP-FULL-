'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import {
  Users, Search, Phone, MapPin, ChevronRight, Loader2, AlertCircle, X,
  UserPlus, Send, CheckCircle, XCircle, Clock, Crosshair, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { useSunatReniec } from '@/lib/hooks/use-sunat-reniec'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import LeafletMap from '@/components/maps/leaflet-map'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Cliente, Pedido, Cobro } from '@/types'
import UbigeoSelector, { UBIGEO_EMPTY, type UbigeoValue } from '@/components/ubigeo-selector'
import { matchUbigeoFromNombres } from '@/lib/ubigeo/match'

interface ClienteConDeuda extends Cliente {
  deuda_pendiente: number
}

interface DetalleCliente {
  cliente: ClienteConDeuda
  pedidos: Pedido[]
  cobros: Cobro[]
}

interface SolicitudCliente {
  id: string
  razon_social: string
  ruc: string | null
  dni: string | null
  tipo_cliente: 'consumidor_final' | 'tienda'
  direccion: string | null
  telefono: string | null
  estado: 'pendiente' | 'aprobada' | 'rechazada'
  razon_rechazo: string | null
  created_at: string
}

const estadoColors: Record<string, string> = {
  activo: 'bg-green-100 text-green-700',
  inactivo: 'bg-gray-100 text-gray-600',
  deudor: 'bg-amber-100 text-amber-700',
  de_baja: 'bg-red-100 text-red-700',
  suspendido: 'bg-amber-100 text-amber-700',
  bloqueado: 'bg-red-100 text-red-700',
}

const estadoLabels: Record<string, string> = {
  activo: 'Activo',
  inactivo: 'Inactivo',
  deudor: 'Deudor',
  de_baja: 'De Baja',
  suspendido: 'Suspendido',
  bloqueado: 'Bloqueado',
}

type TipoDoc = 'ruc' | 'dni'
type TipoCliente = 'consumidor_final' | 'tienda'

export default function ClientesPage() {
  const [clientes, setClientes] = useState<ClienteConDeuda[]>([])
  const [filtrados, setFiltrados] = useState<ClienteConDeuda[]>([])
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [loading, setLoading] = useState(true)
  const [detalle, setDetalle] = useState<DetalleCliente | null>(null)
  const [loadingDetalle, setLoadingDetalle] = useState(false)

  // Estado para solicitudes
  const [solicitudes, setSolicitudes] = useState<SolicitudCliente[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [zonas, setZonas] = useState<any[]>([])

  // Modal de solicitud
  const [openSolicitud, setOpenSolicitud] = useState(false)
  const [saving, setSaving] = useState(false)
  const [locLoading, setLocLoading] = useState(false)

  // Form fields
  const [razonSocial, setRazonSocial] = useState('')
  const [tipoDoc, setTipoDoc] = useState<TipoDoc>('ruc')
  const [docValue, setDocValue] = useState('')
  const [tipoCliente, setTipoCliente] = useState<TipoCliente>('tienda')
  const [direccion, setDireccion] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [contacto, setContacto] = useState('')
  const [zonaId, setZonaId] = useState<string>('')
  const [notas, setNotas] = useState('')
  const [picked, setPicked] = useState<[number, number] | null>(null)
  const [ubigeoVal, setUbigeoVal] = useState<UbigeoValue>(UBIGEO_EMPTY)

  const supabase = createClient()
  const { consultarRuc, consultarDni, geocodificar, loading: sunatLoading } = useSunatReniec()

  const autocompletarDoc = async () => {
    if (tipoDoc === 'ruc') {
      const data = await consultarRuc(docValue.trim())
      if (!data) return
      setRazonSocial(data.razonSocial)
      if (data.direccion) setDireccion(data.direccion)
      setTipoCliente('tienda')
      // Auto-seleccionar zona si hay match con distrito
      if (data.distrito) {
        const match = zonas.find((z: any) =>
          (z.nombre ?? '').toLowerCase().includes(data.distrito!.toLowerCase()),
        )
        if (match) setZonaId(match.id)
      }
      // Geocodificar en el mapa
      const geo = await geocodificar({
        direccion: data.direccion,
        distrito: data.distrito,
        provincia: data.provincia,
        departamento: data.departamento,
      })
      if (geo) {
        setPicked([geo.lat, geo.lng])
        toast.success('Ubicación estimada en el mapa', {
          description: `Confianza ${geo.confianza}. Ajusta con "Usar mi ubicación" o tocando el mapa.`,
        })
      }
      // Matching automático de ubigeo desde nombres SUNAT
      if (data.departamento || data.provincia || data.distrito) {
        const matched = await matchUbigeoFromNombres({
          departamento: data.departamento,
          provincia: data.provincia,
          distrito: data.distrito,
        })
        if (matched) setUbigeoVal(matched)
      }
    } else {
      const data = await consultarDni(docValue.trim())
      if (!data) return
      setRazonSocial(data.nombreCompleto)
      setContacto(data.nombreCompleto)
      setTipoCliente('consumidor_final')
    }
  }

  const cargarSolicitudes = useCallback(async (uid: string) => {
    const { data } = await (supabase.from('solicitudes_cliente' as any) as any)
      .select('id, razon_social, ruc, dni, tipo_cliente, direccion, telefono, estado, razon_rechazo, created_at')
      .eq('vendedor_id', uid)
      .order('created_at', { ascending: false })
      .limit(20)
    setSolicitudes((data ?? []) as SolicitudCliente[])
  }, [])

  useEffect(() => {
    async function cargar() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }
      setUserId(user.id)

      const [clientesRes, zonasRes] = await Promise.all([
        supabase.from('clientes').select('*').eq('vendedor_id', user.id).order('razon_social'),
        supabase.from('zonas').select('id, nombre').eq('activo', true).order('nombre'),
      ])

      const clientesData = clientesRes.data ?? []
      setZonas(zonasRes.data ?? [])

      const ids = clientesData.map((c) => c.id)
      const facturadoPorCliente: Record<string, number> = {}
      const cobradoPorCliente: Record<string, number> = {}
      if (ids.length > 0) {
        const [{ data: comps }, { data: cobros }] = await Promise.all([
          supabase
            .from('comprobantes')
            .select('cliente_id, total')
            .in('cliente_id', ids)
            .neq('estado', 'anulado'),
          supabase
            .from('cobros')
            .select('cliente_id, total')
            .in('cliente_id', ids),
        ])
        comps?.forEach((c: any) => {
          if (!c.cliente_id) return
          facturadoPorCliente[c.cliente_id] = (facturadoPorCliente[c.cliente_id] ?? 0) + Number(c.total ?? 0)
        })
        cobros?.forEach((c: any) => {
          if (!c.cliente_id) return
          cobradoPorCliente[c.cliente_id] = (cobradoPorCliente[c.cliente_id] ?? 0) + Number(c.total ?? 0)
        })
      }

      const clientesConDeuda: ClienteConDeuda[] = clientesData.map((c) => {
        const facturado = facturadoPorCliente[c.id] ?? 0
        const cobrado = cobradoPorCliente[c.id] ?? 0
        return {
          ...c,
          deuda_pendiente: Math.max(0, facturado - cobrado),
        }
      })

      setClientes(clientesConDeuda)
      setFiltrados(clientesConDeuda)

      await cargarSolicitudes(user.id)

      setLoading(false)
    }

    cargar()
  }, [cargarSolicitudes])

  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setFiltrados(clientes)
      return
    }
    const q = debouncedSearch.toLowerCase()
    setFiltrados(
      clientes.filter(
        (c) =>
          c.razon_social.toLowerCase().includes(q) ||
          (c.ruc ?? '').toLowerCase().includes(q) ||
          (c.dni ?? '').toLowerCase().includes(q) ||
          (c.telefono ?? '').includes(q)
      )
    )
  }, [debouncedSearch, clientes])

  async function verDetalle(cliente: ClienteConDeuda) {
    setLoadingDetalle(true)
    setDetalle({ cliente, pedidos: [], cobros: [] })

    const [{ data: pedidos }, { data: cobros }] = await Promise.all([
      supabase
        .from('pedidos')
        .select('*')
        .eq('cliente_id', cliente.id)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('cobros')
        .select('*')
        .eq('cliente_id', cliente.id)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    setDetalle({
      cliente,
      pedidos: (pedidos ?? []) as Pedido[],
      cobros: (cobros ?? []) as Cobro[],
    })
    setLoadingDetalle(false)
  }

  const abrirSolicitud = () => {
    setRazonSocial('')
    setTipoDoc('ruc')
    setDocValue('')
    setTipoCliente('tienda')
    setDireccion('')
    setTelefono('')
    setEmail('')
    setContacto('')
    setZonaId('')
    setNotas('')
    setPicked(null)
    setUbigeoVal(UBIGEO_EMPTY)
    setOpenSolicitud(true)
  }

  const usarMiUbicacion = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocalización no soportada por el navegador')
      return
    }
    setLocLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPicked([pos.coords.latitude, pos.coords.longitude])
        toast.success('Ubicación capturada', {
          description: `±${Math.round(pos.coords.accuracy)}m de precisión`,
        })
        setLocLoading(false)
      },
      (err) => {
        toast.error('No se pudo obtener la ubicación', { description: err.message })
        setLocLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const enviarSolicitud = async () => {
    if (!userId) {
      toast.error('Sesión no disponible')
      return
    }
    if (!razonSocial.trim() || razonSocial.trim().length < 2) {
      toast.error('Razón social requerida', { description: 'Ingresa al menos 2 caracteres.' })
      return
    }

    // Validar teléfono peruano 9 dígitos si se ingresó algo
    const tel = telefono.trim()
    if (tel && !/^9\d{8}$/.test(tel)) {
      toast.error('Celular inválido', {
        description: 'Debe tener 9 dígitos empezando por 9 (celular peruano).',
      })
      return
    }

    setSaving(true)
    try {
      const payload: any = {
        vendedor_id: userId,
        razon_social: razonSocial.trim(),
        ruc: tipoDoc === 'ruc' ? (docValue.trim() || null) : null,
        dni: tipoDoc === 'dni' ? (docValue.trim() || null) : null,
        tipo_cliente: tipoCliente,
        direccion: direccion.trim() || null,
        telefono: tel || null,
        email: email.trim() || null,
        contacto: contacto.trim() || null,
        zona_id: zonaId || null,
        latitud: picked ? picked[0] : null,
        longitud: picked ? picked[1] : null,
        notas: notas.trim() || null,
        ubigeo: ubigeoVal.ubigeo,
        departamento: ubigeoVal.departamento,
        provincia: ubigeoVal.provincia,
        distrito: ubigeoVal.distrito,
      }

      const { error } = await (supabase.from('solicitudes_cliente' as any) as any).insert(payload)
      if (error) throw error

      toast.success('Solicitud enviada', {
        description: 'Un gerente la revisará pronto.',
      })
      setOpenSolicitud(false)
      await cargarSolicitudes(userId)
    } catch (err: any) {
      toast.error('No se pudo enviar la solicitud', {
        description: err?.message ?? 'Intenta nuevamente.',
      })
    } finally {
      setSaving(false)
    }
  }

  const estadoPedidoBadge: Record<string, string> = {
    borrador: 'bg-gray-100 text-gray-700',
    enviado: 'bg-blue-100 text-blue-700',
    validado: 'bg-indigo-100 text-indigo-700',
    facturado: 'bg-purple-100 text-purple-700',
    despachado: 'bg-orange-100 text-orange-700',
    entregado: 'bg-green-100 text-green-700',
    cancelado: 'bg-red-100 text-red-700',
  }

  if (detalle) {
    const { cliente, pedidos, cobros } = detalle
    return (
      <div className="min-h-full">
        {/* Header detalle */}
        <div className="bg-black text-white px-4 pt-6 pb-4 border-b-4 border-[#FBE600]">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setDetalle(null)}
              className="flex items-center gap-1 text-gray-300 text-sm hover:text-white"
            >
              <X className="w-4 h-4" />
              Volver a clientes
            </button>
            <Image src="/logo-agrocar.png" alt="AGROCAR" width={120} height={32} className="object-contain" />
          </div>
          <h1 className="text-xl font-bold">{cliente.razon_social}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoColors[cliente.estado] ?? 'bg-gray-100 text-gray-700'}`}>
              {estadoLabels[cliente.estado] ?? cliente.estado}
            </span>
            {cliente.ruc ? (
              <span className="text-gray-300 text-xs font-mono">RUC {cliente.ruc}</span>
            ) : cliente.dni ? (
              <span className="text-gray-300 text-xs font-mono">DNI {cliente.dni}</span>
            ) : null}
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Datos del cliente */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-2">
              {cliente.direccion && (
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <MapPin className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
                  {cliente.direccion}
                </div>
              )}
              {cliente.telefono && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Phone className="w-4 h-4 text-gray-400" />
                  <a href={`tel:${cliente.telefono}`} className="text-gray-900 font-semibold underline decoration-[#FBE600] decoration-2 underline-offset-2">
                    {cliente.telefono}
                  </a>
                </div>
              )}
              {cliente.deuda_pendiente > 0 && (
                <div className="flex items-center gap-2 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <div>
                    <div className="text-xs text-amber-700 font-medium">Deuda pendiente</div>
                    <div className="text-amber-800 font-bold">{formatCurrency(cliente.deuda_pendiente)}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Historial de pedidos */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">Últimos Pedidos</h3>
            {loadingDetalle ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
              </div>
            ) : pedidos.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-sm bg-gray-50 rounded-xl">
                Sin pedidos registrados
              </div>
            ) : (
              <div className="space-y-2">
                {pedidos.map((p) => (
                  <div key={p.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-800">
                        #{p.id.slice(-8).toUpperCase()}
                      </div>
                      <div className="text-xs text-gray-500">{formatDate(p.created_at)}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoPedidoBadge[p.estado] ?? 'bg-gray-100 text-gray-700'}`}>
                        {p.estado}
                      </span>
                      <span className="text-sm font-bold text-green-700">
                        {formatCurrency((p as any).total ?? 0)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Historial de cobros */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">Últimos Cobros</h3>
            {!loadingDetalle && cobros.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-sm bg-gray-50 rounded-xl">
                Sin cobros registrados
              </div>
            ) : (
              <div className="space-y-2">
                {cobros.map((c) => (
                  <div key={c.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-800 capitalize">
                        {(c as any).tipo ?? 'Cobro'}
                      </div>
                      <div className="text-xs text-gray-500">{formatDate(c.created_at)}</div>
                    </div>
                    <span className="text-sm font-bold text-green-700">
                      {formatCurrency((c as any).total ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="bg-black text-white px-4 pt-6 pb-4 border-b-4 border-[#FBE600]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Users className="w-6 h-6" />
            <h1 className="text-xl font-bold">Mis Clientes</h1>
          </div>
          <Image src="/logo-agrocar.png" alt="AGROCAR" width={120} height={32} className="object-contain" />
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nombre, RUC, DNI o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-3 bg-white/10 placeholder-gray-400 text-white rounded-xl text-sm outline-none focus:bg-white/20"
          />
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* Botón solicitar nuevo cliente */}
        <Button
          onClick={abrirSolicitud}
          className="w-full bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold h-12 rounded-xl gap-2 shadow-md"
        >
          <UserPlus className="w-5 h-5" />
          Solicitar Nuevo Cliente
        </Button>

        {/* Solicitudes del vendedor */}
        {solicitudes.length > 0 && (
          <div>
            <h3 className="font-semibold text-gray-800 mb-2 text-sm">
              Mis solicitudes ({solicitudes.length})
            </h3>
            <div className="space-y-2">
              {solicitudes.map((s) => {
                const estadoConfig =
                  s.estado === 'pendiente'
                    ? { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', label: 'Pendiente', Icon: Clock }
                    : s.estado === 'aprobada'
                    ? { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', label: 'Aprobada', Icon: CheckCircle }
                    : { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', label: 'Rechazada', Icon: XCircle }

                return (
                  <Card key={s.id} className={`border ${estadoConfig.border} shadow-sm`}>
                    <CardContent className={`p-3 ${estadoConfig.bg}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 text-sm truncate">{s.razon_social}</p>
                          <p className="text-xs text-gray-500 font-mono mt-0.5">
                            {s.ruc ?? s.dni ?? 'Sin documento'}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {formatDate(s.created_at)}
                          </p>
                          {s.estado === 'rechazada' && s.razon_rechazo && (
                            <p className={`text-xs ${estadoConfig.text} mt-1.5 font-medium`}>
                              Motivo: {s.razon_rechazo}
                            </p>
                          )}
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${estadoConfig.text} ${estadoConfig.bg} border ${estadoConfig.border} shrink-0`}>
                          <estadoConfig.Icon className="w-3 h-3" />
                          {estadoConfig.label}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {/* Lista de clientes */}
        <div>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-600" />
            </div>
          ) : filtrados.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500 font-medium">
                {search ? 'Sin resultados para tu búsqueda' : 'Sin clientes asignados'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 mb-3">{filtrados.length} clientes</p>
              {filtrados.map((cliente) => (
                <button
                  key={cliente.id}
                  onClick={() => verDetalle(cliente)}
                  className="w-full text-left"
                >
                  <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-gray-900 text-sm truncate">
                              {cliente.razon_social}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoColors[cliente.estado] ?? 'bg-gray-100 text-gray-600'}`}>
                              {estadoLabels[cliente.estado] ?? cliente.estado}
                            </span>
                            {cliente.ruc ? (
                              <span className="text-xs text-gray-400 font-mono">RUC {cliente.ruc}</span>
                            ) : cliente.dni ? (
                              <span className="text-xs text-gray-400 font-mono">DNI {cliente.dni}</span>
                            ) : null}
                          </div>
                          {cliente.direccion && (
                            <div className="flex items-center gap-1 mt-1.5 text-xs text-gray-500">
                              <MapPin className="w-3 h-3" />
                              <span className="truncate">{cliente.direccion}</span>
                            </div>
                          )}
                          {cliente.telefono && (
                            <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500">
                              <Phone className="w-3 h-3" />
                              {cliente.telefono}
                            </div>
                          )}
                          {cliente.deuda_pendiente > 0 && (
                            <div className="mt-1.5 text-xs font-medium text-amber-700">
                              Deuda: {formatCurrency(cliente.deuda_pendiente)}
                            </div>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-300 mt-1 shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal Solicitud Nuevo Cliente */}
      <Dialog open={openSolicitud} onOpenChange={setOpenSolicitud}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-black" />
              Solicitar Nuevo Cliente
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <div>
              <Label>Razón Social *</Label>
              <Input
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                placeholder="Nombre del negocio"
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-[90px_1fr] gap-2">
              <div>
                <Label>Doc.</Label>
                <Select value={tipoDoc} onValueChange={(v) => { setTipoDoc(v as TipoDoc); setDocValue('') }}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ruc">RUC</SelectItem>
                    <SelectItem value="dni">DNI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{tipoDoc === 'ruc' ? 'RUC' : 'DNI'}</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={docValue}
                    onChange={(e) => setDocValue(e.target.value.replace(/\D/g, '').slice(0, tipoDoc === 'ruc' ? 11 : 8))}
                    placeholder={tipoDoc === 'ruc' ? '20xxxxxxxxx' : '12345678'}
                    maxLength={tipoDoc === 'ruc' ? 11 : 8}
                    inputMode="numeric"
                    className="font-mono flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={autocompletarDoc}
                    disabled={sunatLoading || !docValue || docValue.length !== (tipoDoc === 'ruc' ? 11 : 8)}
                    className="shrink-0 gap-1 border-[#FBE600] hover:bg-[#FBE600] hover:text-black"
                  >
                    {sunatLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {tipoDoc === 'ruc' ? 'SUNAT' : 'RENIEC'}
                  </Button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  Se auto-completará razón social{tipoDoc === 'ruc' ? ' y dirección' : ''}.
                </p>
              </div>
            </div>

            <div>
              <Label>Tipo de cliente</Label>
              <Select value={tipoCliente} onValueChange={(v) => setTipoCliente(v as TipoCliente)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tienda">Tienda</SelectItem>
                  <SelectItem value="consumidor_final">Consumidor final</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-semibold text-gray-700">Ubicación administrativa</Label>
              <div className="mt-1">
                <UbigeoSelector value={ubigeoVal} onChange={setUbigeoVal} layout="stacked" showLabels />
              </div>
            </div>

            <div>
              <Label>Dirección</Label>
              <Input
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="Av. ..."
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Celular (WhatsApp)</Label>
                <Input
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value.replace(/\D/g, '').slice(0, 9))}
                  placeholder="9XXXXXXXX"
                  maxLength={9}
                  inputMode="numeric"
                  className="mt-1 font-mono"
                />
                {telefono && !/^9\d{8}$/.test(telefono) && (
                  <p className="text-[11px] text-red-500 mt-1">9 dígitos empezando por 9</p>
                )}
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="correo@..."
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label>Contacto</Label>
              <Input
                value={contacto}
                onChange={(e) => setContacto(e.target.value)}
                placeholder="Nombre del contacto"
                className="mt-1"
              />
            </div>

            <div>
              <Label>Zona</Label>
              <Select value={zonaId} onValueChange={setZonaId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Selecciona zona (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  {zonas.map((z) => (
                    <SelectItem key={z.id} value={z.id}>{z.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="flex items-center gap-1">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  Ubicación en mapa
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={usarMiUbicacion}
                  disabled={locLoading}
                  className="h-7 text-xs gap-1"
                >
                  {locLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Crosshair className="w-3 h-3" />}
                  Usar mi ubicación
                </Button>
              </div>
              <LeafletMap
                pickable
                pickedPosition={picked}
                onPick={(lat, lng) => setPicked([lat, lng])}
                height="220px"
              />
              {picked && (
                <p className="text-xs text-gray-500 mt-1 font-mono">
                  {picked[0].toFixed(5)}, {picked[1].toFixed(5)}
                </p>
              )}
            </div>

            <div>
              <Label>Notas</Label>
              <Textarea
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Observaciones adicionales..."
                className="mt-1"
                rows={3}
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-gray-100">
              <Button variant="outline" onClick={() => setOpenSolicitud(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button
                onClick={enviarSolicitud}
                disabled={saving}
                className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Enviar Solicitud
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
