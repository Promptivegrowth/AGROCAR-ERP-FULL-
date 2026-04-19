'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { MapPin, Loader2, CheckCircle, AlertCircle, Navigation, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import type { Cliente, GpsCheckin } from '@/types'
import LeafletMap from '@/components/maps/leaflet-map'

type TipoVisita = 'entrada' | 'salida' | 'visita_sin_compra'

interface CheckinLocal extends GpsCheckin {
  cliente_nombre?: string
}

export default function CheckinPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [clienteSeleccionado, setClienteSeleccionado] = useState<string>('')
  const [tipoVisita, setTipoVisita] = useState<TipoVisita>('entrada')
  const [coordenadas, setCoordenadas] = useState<{ lat: number; lng: number; precision: number } | null>(null)
  const [obteniendoGPS, setObteniendoGPS] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [mensajeExito, setMensajeExito] = useState<string | null>(null)
  const [mensajeError, setMensajeError] = useState<string | null>(null)
  const [checkinsDia, setCheckinsDia] = useState<CheckinLocal[]>([])
  const [loadingCheckins, setLoadingCheckins] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      setLoadingCheckins(true)

      const hoy = new Date().toISOString().split('T')[0]

      // Paralelizar: clientes asignados + check-ins del día
      const [{ data: clientesData }, { data: checkinsData }] = await Promise.all([
        supabase
          .from('clientes')
          .select('id, razon_social, codigo')
          .eq('vendedor_id', user.id)
          .eq('estado', 'activo')
          .order('razon_social'),
        supabase
          .from('gps_checkins')
          .select('*, clientes(razon_social)')
          .eq('usuario_id', user.id)
          .gte('created_at', hoy)
          .order('created_at', { ascending: false }),
      ])

      setClientes((clientesData ?? []) as Cliente[])

      const mapped = (checkinsData ?? [] as any[]).map((c: any) => ({
        ...c,
        cliente_nombre: c.clientes?.razon_social ?? '',
      }))
      setCheckinsDia(mapped)
      setLoadingCheckins(false)
    }
    init()
  }, [])

  async function cargarCheckinsDia(uid: string) {
    setLoadingCheckins(true)
    const hoy = new Date().toISOString().split('T')[0]

    const { data } = await supabase
      .from('gps_checkins')
      .select('*, clientes(razon_social)')
      .eq('usuario_id', uid)
      .gte('created_at', hoy)
      .order('created_at', { ascending: false })

    const mapped = (data ?? [] as any[]).map((c: any) => ({
      ...c,
      cliente_nombre: c.clientes?.razon_social ?? '',
    }))

    setCheckinsDia(mapped)
    setLoadingCheckins(false)
  }

  function obtenerGPS() {
    setGpsError(null)
    setCoordenadas(null)
    setObteniendoGPS(true)

    if (!navigator.geolocation) {
      setGpsError('Tu dispositivo no soporta geolocalización')
      setObteniendoGPS(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoordenadas({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precision: Math.round(pos.coords.accuracy),
        })
        setObteniendoGPS(false)
      },
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setGpsError('Permiso de ubicación denegado. Actívalo en la configuración del navegador.')
            break
          case err.POSITION_UNAVAILABLE:
            setGpsError('Ubicación no disponible. Verifica que el GPS esté activado.')
            break
          case err.TIMEOUT:
            setGpsError('Tiempo de espera agotado. Intenta nuevamente.')
            break
          default:
            setGpsError('Error al obtener ubicación.')
        }
        setObteniendoGPS(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  async function registrarCheckin() {
    if (!clienteSeleccionado || !coordenadas || !userId) return
    setEnviando(true)
    setMensajeError(null)
    setMensajeExito(null)

    try {
      const { error } = await supabase.from('gps_checkins').insert({
        usuario_id: userId,
        cliente_id: clienteSeleccionado,
        tipo: tipoVisita,
        latitud: coordenadas.lat,
        longitud: coordenadas.lng,
        precision_metros: coordenadas.precision,
      })

      if (error) {
        setMensajeError('Error al registrar el check-in: ' + error.message)
        toast.error('No se pudo registrar el check-in', { description: error.message })
        return
      }

      const clienteNombre = clientes.find((c) => c.id === clienteSeleccionado)?.razon_social ?? ''
      const tipoLabel = tipoLabels[tipoVisita]
      setMensajeExito(`${tipoLabel} registrado en ${clienteNombre}`)
      toast.success(`${tipoLabel} registrado`, { description: clienteNombre })
      setClienteSeleccionado('')
      setCoordenadas(null)
      setTipoVisita('entrada')
      await cargarCheckinsDia(userId)
    } catch {
      setMensajeError('Error inesperado al registrar el check-in')
      toast.error('Error inesperado', { description: 'No se pudo registrar el check-in.' })
    } finally {
      setEnviando(false)
    }
  }

  const tipoLabels: Record<TipoVisita, string> = {
    entrada: 'Check-in',
    salida: 'Check-out',
    visita_sin_compra: 'Visita sin compra',
  }

  const tipoColors: Record<TipoVisita, string> = {
    entrada: 'bg-green-100 text-green-700',
    salida: 'bg-blue-100 text-blue-700',
    visita_sin_compra: 'bg-gray-100 text-gray-700',
  }

  const tipoIcono: Record<TipoVisita, string> = {
    entrada: '✅',
    salida: '👋',
    visita_sin_compra: '👁️',
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="bg-black text-white px-4 pt-6 pb-4 border-b-4 border-[#FBE600]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="w-6 h-6" />
            <h1 className="text-xl font-bold">Check-in GPS</h1>
          </div>
          <Image src="/logo-agrocar.png" alt="AGROCAR" width={120} height={32} className="object-contain" />
        </div>
        <p className="text-gray-300 text-sm mt-1">Registra tus visitas con ubicación</p>
      </div>

      <div className="p-4 space-y-4">
        {mensajeExito && (
          <div className="bg-green-50 border border-green-200 text-green-700 flex items-center gap-2 px-4 py-3 rounded-xl">
            <CheckCircle className="w-4 h-4 shrink-0" />
            {mensajeExito}
          </div>
        )}
        {mensajeError && (
          <div className="bg-red-50 border border-red-200 text-red-700 flex items-center gap-2 px-4 py-3 rounded-xl">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {mensajeError}
          </div>
        )}

        {/* Selector de cliente */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <h3 className="font-semibold text-gray-800 mb-3">1. Cliente</h3>
            <select
              value={clienteSeleccionado}
              onChange={(e) => setClienteSeleccionado(e.target.value)}
              className="w-full h-12 px-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-[#FBE600]"
            >
              <option value="">Selecciona un cliente...</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razon_social} {c.codigo ? `(${c.codigo})` : ''}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>

        {/* Tipo de visita */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <h3 className="font-semibold text-gray-800 mb-3">2. Tipo de Visita</h3>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(tipoLabels) as TipoVisita[]).map((tipo) => (
                <button
                  key={tipo}
                  onClick={() => setTipoVisita(tipo)}
                  className={`py-3 px-2 rounded-xl border-2 text-center text-sm font-medium transition-all ${
                    tipoVisita === tipo
                      ? 'border-[#FBE600] bg-yellow-50 text-black'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <div className="text-lg mb-1">{tipoIcono[tipo]}</div>
                  <div className="text-xs leading-tight">{tipoLabels[tipo]}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* GPS */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <h3 className="font-semibold text-gray-800 mb-3">3. Ubicación GPS</h3>

            <Button
              onClick={obtenerGPS}
              disabled={obteniendoGPS}
              variant="outline"
              className="w-full h-12 border-gray-300 text-gray-800 hover:bg-yellow-50 hover:border-[#FBE600]"
            >
              {obteniendoGPS ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Obteniendo ubicación...
                </>
              ) : (
                <>
                  <Navigation className="w-4 h-4" />
                  {coordenadas ? 'Actualizar ubicación' : 'Obtener mi ubicación'}
                </>
              )}
            </Button>

            {gpsError && (
              <div className="mt-2 flex items-start gap-1.5 text-red-600 text-xs">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {gpsError}
              </div>
            )}

            {coordenadas && (
              <div className="mt-3 space-y-2">
                <LeafletMap
                  height="200px"
                  markers={[{
                    id: 'me',
                    lat: coordenadas.lat,
                    lng: coordenadas.lng,
                    label: 'Tu ubicación',
                    description: `±${coordenadas.precision}m`,
                  }]}
                />
                <div className="bg-green-50 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-green-700 font-medium text-sm mb-1">
                    <CheckCircle className="w-4 h-4" />
                    Ubicación obtenida
                  </div>
                  <div className="text-xs text-green-700 space-y-0.5">
                    <div>Lat: <span className="font-mono font-medium">{coordenadas.lat.toFixed(6)}</span></div>
                    <div>Lng: <span className="font-mono font-medium">{coordenadas.lng.toFixed(6)}</span></div>
                    <div>Precisión: <span className="font-medium">±{coordenadas.precision} m</span></div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Botón registrar */}
        <Button
          onClick={registrarCheckin}
          disabled={!clienteSeleccionado || !coordenadas || enviando}
          className="w-full h-16 bg-[#FBE600] hover:bg-[#E5D100] text-black font-bold text-lg rounded-2xl shadow-md"
        >
          {enviando ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Registrando...
            </>
          ) : (
            <>
              <MapPin className="w-6 h-6" />
              {tipoLabels[tipoVisita].toUpperCase()}
            </>
          )}
        </Button>

        {/* Check-ins del día */}
        <div>
          <h3 className="font-semibold text-gray-800 mb-3">Check-ins de Hoy</h3>
          {loadingCheckins ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
            </div>
          ) : checkinsDia.length === 0 ? (
            <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-xl">
              <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Sin check-ins hoy</p>
            </div>
          ) : (
            <div className="space-y-2">
              {checkinsDia.map((checkin) => (
                <Card key={checkin.id} className="border-0 shadow-sm">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-gray-900 text-sm">
                          {checkin.cliente_nombre ?? 'Cliente'}
                        </div>
                        <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                          <Clock className="w-3 h-3" />
                          {formatDate(checkin.created_at)}
                        </div>
                        {(checkin as GpsCheckin & { precision_metros?: number }).precision_metros && (
                          <div className="text-xs text-gray-400 mt-0.5">
                            Precisión: ±{(checkin as GpsCheckin & { precision_metros?: number }).precision_metros}m
                          </div>
                        )}
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${tipoColors[checkin.tipo as TipoVisita] ?? 'bg-gray-100 text-gray-700'}`}>
                        {tipoLabels[checkin.tipo as TipoVisita] ?? checkin.tipo}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
