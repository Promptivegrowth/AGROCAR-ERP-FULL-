import { createClient } from '@/lib/supabase/server'
import { MapPin, Clock, User, Navigation } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

async function getGPSData() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const [{ data: checkins }, { data: vendedoresActivos }] = await Promise.all([
    supabase
      .from('gps_checkins')
      .select(`
        id, tipo, latitud, longitud, cliente_id, created_at,
        profiles!gps_checkins_vendedor_id_fkey(full_name, role),
        clientes(razon_social)
      `)
      .gte('created_at', `${today}T00:00:00`)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('profiles')
      .select('id, full_name, role, activo')
      .in('role', ['vendedor', 'repartidor'])
      .eq('activo', true)
      .order('full_name'),
  ])

  // Última ubicación por vendedor
  const ultimaUbicacion: Record<string, any> = {}
  checkins?.forEach((c) => {
    const vid = (c as any).vendedor_id
    if (vid && !ultimaUbicacion[vid]) {
      ultimaUbicacion[vid] = c
    }
  })

  return {
    checkins: checkins ?? [],
    vendedoresActivos: vendedoresActivos ?? [],
    ultimaUbicacion,
  }
}

const TIPO_CONFIG: Record<string, { label: string; className: string }> = {
  entrada: { label: 'Entrada', className: 'bg-green-100 text-green-700' },
  salida: { label: 'Salida', className: 'bg-red-100 text-red-700' },
  visita_sin_compra: { label: 'Visita s/compra', className: 'bg-yellow-100 text-yellow-700' },
}

export default async function GPSPage() {
  const { checkins, vendedoresActivos, ultimaUbicacion } = await getGPSData()

  const today = new Date().toLocaleDateString('es-PE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Supervisión GPS</h1>
        <p className="text-sm text-gray-500 mt-0.5 capitalize">{today}</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Mapa placeholder */}
        <div className="xl:col-span-2">
          <Card className="border-gray-200 shadow-sm overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <Navigation className="w-4 h-4 text-green-600" />
                Mapa de Seguimiento — Tacna, Perú
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Mapa placeholder profesional */}
              <div
                className="relative h-[420px] bg-gradient-to-br from-green-50 via-blue-50 to-green-100 flex flex-col items-center justify-center"
                style={{
                  backgroundImage: `
                    radial-gradient(circle at 30% 40%, rgba(22,163,74,0.08) 0%, transparent 60%),
                    radial-gradient(circle at 70% 60%, rgba(59,130,246,0.08) 0%, transparent 60%),
                    repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(156,163,175,0.15) 40px),
                    repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(156,163,175,0.15) 40px)
                  `,
                }}
              >
                {/* Pines simulados */}
                {vendedoresActivos.slice(0, 5).map((v, i) => {
                  const positions = [
                    { top: '30%', left: '25%' },
                    { top: '55%', left: '45%' },
                    { top: '40%', left: '65%' },
                    { top: '65%', left: '30%' },
                    { top: '25%', left: '70%' },
                  ]
                  const pos = positions[i] ?? { top: '50%', left: '50%' }
                  const initials = v.full_name?.split(' ').slice(0, 2).map((n: string) => n[0]).join('') ?? '?'
                  return (
                    <div
                      key={v.id}
                      className="absolute flex flex-col items-center"
                      style={pos}
                    >
                      <div className="w-9 h-9 bg-green-600 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-white text-xs font-bold">
                        {initials}
                      </div>
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-6 border-l-transparent border-r-transparent border-t-green-600" />
                      <div className="mt-1 bg-white rounded px-1.5 py-0.5 text-xs font-medium text-gray-700 shadow whitespace-nowrap border border-gray-200">
                        {v.full_name?.split(' ')[0] ?? 'Vendedor'}
                      </div>
                    </div>
                  )
                })}

                <div className="absolute bottom-4 right-4 bg-white rounded-lg border border-gray-200 shadow px-3 py-2 text-xs text-gray-500">
                  <p className="font-semibold text-gray-700 mb-1">Mapa en desarrollo</p>
                  <p>Integración con Google Maps API</p>
                  <p className="text-green-600 font-medium mt-0.5">Tacna, Perú — 18°S 70°W</p>
                </div>

                <div className="text-center z-10">
                  <div className="w-16 h-16 bg-white rounded-2xl shadow-lg flex items-center justify-center mb-3 mx-auto border border-gray-100">
                    <MapPin className="w-8 h-8 text-green-600" />
                  </div>
                  <p className="text-gray-600 font-semibold text-sm">Mapa GPS Activo</p>
                  <p className="text-gray-400 text-xs mt-1">{vendedoresActivos.length} vendedores en ruta hoy</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Panel de vendedores */}
        <div className="space-y-4">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">
                Vendedores Activos ({vendedoresActivos.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {vendedoresActivos.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Sin vendedores activos</p>
              ) : (
                vendedoresActivos.map((v) => {
                  const ultima = Object.values(ultimaUbicacion).find((u: any) =>
                    u?.profiles?.full_name === v.full_name
                  ) as any
                  const initials = v.full_name?.split(' ').slice(0, 2).map((n: string) => n[0]).join('') ?? '?'
                  const tieneUbicacion = !!ultima
                  return (
                    <div key={v.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                      <div className="w-9 h-9 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs font-bold">{initials}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{v.full_name}</p>
                        <p className="text-xs text-gray-400 capitalize">{v.role}</p>
                        {ultima && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            Última: {new Date(ultima.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                      <div className={`w-2 h-2 rounded-full ${tieneUbicacion ? 'bg-green-500' : 'bg-gray-300'}`} />
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Historial de check-ins */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-gray-800">
            Historial de Check-ins ({checkins.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {checkins.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No hay check-ins registrados hoy</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Hora', 'Vendedor', 'Tipo', 'Cliente', 'Coordenadas'].map((h) => (
                      <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {checkins.map((c: any) => {
                    const tipoCfg = TIPO_CONFIG[c.tipo] ?? { label: c.tipo, className: 'bg-gray-100 text-gray-600' }
                    return (
                      <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-2.5 px-4 text-gray-500 text-xs font-mono">
                          {new Date(c.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-gray-800">{c.profiles?.full_name ?? '—'}</td>
                        <td className="py-2.5 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tipoCfg.className}`}>
                            {tipoCfg.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-gray-600">{c.clientes?.razon_social ?? '—'}</td>
                        <td className="py-2.5 px-4 text-gray-400 font-mono text-xs">
                          {c.latitud && c.longitud
                            ? `${Number(c.latitud).toFixed(5)}, ${Number(c.longitud).toFixed(5)}`
                            : '—'
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
