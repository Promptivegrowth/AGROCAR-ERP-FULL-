'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Map, MapPin, Phone, Calendar, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { labelDias, diaHoy, DIAS, type DiaSemana } from '@/lib/dias-visita'

interface Zona {
  id: string
  nombre: string
  descripcion: string | null
  color_hex: string | null
  dias_visita: string[]
}

interface ClienteZona {
  id: string
  razon_social: string
  ruc: string | null
  dni: string | null
  telefono: string | null
  direccion: string | null
  latitud: number | null
  longitud: number | null
  dias_visita: string[] | null
  zona_id: string
  direcciones_extra: Array<{ id: string; nombre: string; direccion: string }>
}

export default function MiZonaPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [zonas, setZonas] = useState<Zona[]>([])
  const [clientes, setClientes] = useState<ClienteZona[]>([])
  const [expandedZonas, setExpandedZonas] = useState<Set<string>>(new Set())
  const [filtroDia, setFiltroDia] = useState<'hoy' | 'todos' | DiaSemana>('hoy')
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function cargar() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Rol del usuario
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      const role = (profile as any)?.role

      // Zonas asignadas al usuario (via profile_zonas o profiles.zona_id)
      let zonasAsignadas: string[] = []
      const { data: pz } = await (supabase as any)
        .from('profile_zonas')
        .select('zona_id')
        .eq('profile_id', user.id)
      zonasAsignadas = (pz ?? []).map((p: any) => p.zona_id).filter(Boolean)

      if (zonasAsignadas.length === 0) {
        // fallback al campo legacy profiles.zona_id
        const { data: prof } = await supabase
          .from('profiles')
          .select('zona_id')
          .eq('id', user.id)
          .single()
        const zid = (prof as any)?.zona_id
        if (zid) zonasAsignadas = [zid]
      }

      // Si es repartidor, mostrar todas las zonas activas
      const esRepartidor = role === 'repartidor'

      const zonasQ = (supabase as any)
        .from('zonas')
        .select('id, nombre, descripcion, color_hex, dias_visita')
        .eq('activo', true)
        .order('nombre')
      const { data: zs } = esRepartidor
        ? await zonasQ
        : await zonasQ.in('id', zonasAsignadas.length > 0 ? zonasAsignadas : ['00000000-0000-0000-0000-000000000000'])

      const zonasArr = ((zs ?? []) as any[]) as Zona[]
      setZonas(zonasArr)
      // Expandir todas por default
      setExpandedZonas(new Set(zonasArr.map((z) => z.id)))

      // Clientes de esas zonas
      const ids = zonasArr.map((z) => z.id)
      if (ids.length > 0) {
        const { data: cs } = await (supabase as any)
          .from('clientes')
          .select('id, razon_social, ruc, dni, telefono, direccion, latitud, longitud, dias_visita, zona_id')
          .in('zona_id', ids)
          .eq('estado', 'activo')
          .order('razon_social')

        const cIds = (cs ?? []).map((c: any) => c.id)
        let direccionesMap: Record<string, any[]> = {}
        if (cIds.length > 0) {
          const { data: dirs } = await (supabase as any)
            .from('cliente_direcciones')
            .select('id, cliente_id, nombre, direccion, es_principal')
            .in('cliente_id', cIds)
            .eq('activo', true)
          ;(dirs ?? []).forEach((d: any) => {
            if (!direccionesMap[d.cliente_id]) direccionesMap[d.cliente_id] = []
            direccionesMap[d.cliente_id].push(d)
          })
        }
        const enriquecidos: ClienteZona[] = (cs ?? []).map((c: any) => ({
          ...c,
          direcciones_extra: direccionesMap[c.id] ?? [],
        }))
        setClientes(enriquecidos)
      }

      setLoading(false)
    }
    cargar()
  }, [supabase])

  const toggleZona = (id: string) => {
    setExpandedZonas((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const hoy = diaHoy()

  // Filtrado de clientes
  const clientesFiltrados = clientes.filter((c) => {
    if (search.trim()) {
      const q = search.toLowerCase()
      if (
        !c.razon_social.toLowerCase().includes(q) &&
        !(c.ruc ?? '').toLowerCase().includes(q) &&
        !(c.dni ?? '').toLowerCase().includes(q) &&
        !(c.direccion ?? '').toLowerCase().includes(q)
      ) return false
    }
    if (filtroDia === 'todos') return true
    const diasEf = (c.dias_visita && c.dias_visita.length > 0)
      ? c.dias_visita
      : (zonas.find((z) => z.id === c.zona_id)?.dias_visita ?? [])
    if (filtroDia === 'hoy') return diasEf.includes(hoy)
    return diasEf.includes(filtroDia)
  })

  const porZona = zonas.map((z) => ({
    zona: z,
    clientes: clientesFiltrados.filter((c) => c.zona_id === z.id),
  }))

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="bg-black text-white px-4 pt-6 pb-4 border-b-4 border-[#FBE600]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Map className="w-6 h-6" />
            <h1 className="text-xl font-bold">Mi Zona</h1>
          </div>
          <Image src="/logo-agrocar.png" alt="AGROCAR" width={120} height={32} className="object-contain" />
        </div>
        <Input
          placeholder="Buscar cliente, dirección..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white/95 text-gray-900 placeholder:text-gray-500"
        />
      </div>

      {/* Filtros */}
      <div className="px-4 pt-4 pb-2 bg-white border-b border-gray-100 overflow-x-auto">
        <div className="flex gap-1.5 min-w-max">
          <button
            onClick={() => setFiltroDia('hoy')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
              filtroDia === 'hoy' ? 'bg-[#FBE600] text-black' : 'bg-gray-100 text-gray-600'
            }`}
          >
            📅 Hoy
          </button>
          <button
            onClick={() => setFiltroDia('todos')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
              filtroDia === 'todos' ? 'bg-[#FBE600] text-black' : 'bg-gray-100 text-gray-600'
            }`}
          >
            Todos
          </button>
          {DIAS.map((d) => (
            <button
              key={d.key}
              onClick={() => setFiltroDia(d.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
                filtroDia === d.key ? 'bg-[#FBE600] text-black' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {d.label.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido */}
      <div className="p-4 space-y-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : porZona.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-10 text-center text-gray-500">
              <Map className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">No tienes zonas asignadas todavía</p>
              <p className="text-xs text-gray-400 mt-1">Pídele al administrador que te asigne una zona</p>
            </CardContent>
          </Card>
        ) : (
          porZona.map(({ zona, clientes: cs }) => {
            const expanded = expandedZonas.has(zona.id)
            const tocaHoy = (zona.dias_visita ?? []).includes(hoy)
            return (
              <Card key={zona.id} className="border-0 shadow-sm overflow-hidden">
                <button
                  onClick={() => toggleZona(zona.id)}
                  className="w-full text-left p-4 hover:bg-gray-50"
                  style={{ borderLeft: `4px solid ${zona.color_hex ?? '#2563eb'}` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-gray-900 truncate">{zona.nombre}</h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          tocaHoy ? 'bg-yellow-100 text-yellow-900 border border-yellow-300' : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}>
                          📅 {labelDias(zona.dias_visita)}
                          {tocaHoy && ' · HOY'}
                        </span>
                        <span className="text-xs text-gray-500">{cs.length} {cs.length === 1 ? 'cliente' : 'clientes'}</span>
                      </div>
                    </div>
                    {expanded ? <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />}
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-gray-100 divide-y divide-gray-100">
                    {cs.length === 0 ? (
                      <div className="p-4 text-center text-xs text-gray-400 italic">
                        Sin clientes para el filtro seleccionado
                      </div>
                    ) : (
                      cs.map((c) => {
                        const diasEf = (c.dias_visita && c.dias_visita.length > 0)
                          ? c.dias_visita
                          : (zona.dias_visita ?? [])
                        const personalizados = (c.dias_visita ?? []).length > 0
                        const visitaHoy = diasEf.includes(hoy)
                        return (
                          <div key={c.id} className={`p-3 ${visitaHoy ? 'bg-yellow-50/40' : ''}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-gray-900 text-sm truncate">
                                  {visitaHoy && <span className="text-yellow-700 mr-1">📍</span>}
                                  {c.razon_social}
                                </p>
                                <p className="text-[11px] text-gray-500 font-mono mt-0.5">
                                  {c.ruc ? `RUC ${c.ruc}` : c.dni ? `DNI ${c.dni}` : 'Sin doc.'}
                                </p>
                                {c.direccion && (
                                  <a
                                    href={c.latitud && c.longitud
                                      ? `https://www.google.com/maps/search/?api=1&query=${c.latitud},${c.longitud}`
                                      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.direccion)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-blue-700 mt-1.5 flex items-start gap-1 hover:underline"
                                  >
                                    <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                                    <span>{c.direccion}</span>
                                  </a>
                                )}
                                {(c.direcciones_extra ?? []).map((d) => (
                                  <a
                                    key={d.id}
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.direccion)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[11px] text-gray-600 mt-0.5 flex items-start gap-1 ml-4 hover:text-blue-700 hover:underline"
                                  >
                                    <span className="text-gray-400">↳</span>
                                    <span><span className="font-medium">{d.nombre}:</span> {d.direccion}</span>
                                  </a>
                                ))}
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                {c.telefono && (
                                  <a
                                    href={`tel:${c.telefono}`}
                                    className="flex items-center gap-1 px-2 py-1 rounded bg-green-50 text-green-700 text-[11px] font-semibold border border-green-200"
                                  >
                                    <Phone className="w-3 h-3" />
                                    {c.telefono}
                                  </a>
                                )}
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] ${
                                  personalizados
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                    : 'bg-gray-50 text-gray-500 border border-gray-200'
                                }`} title={personalizados ? 'Días personalizados' : 'Heredados de la zona'}>
                                  <Calendar className="w-3 h-3 mr-0.5" />
                                  {labelDias(diasEf)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
