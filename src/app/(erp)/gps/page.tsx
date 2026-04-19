import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import GpsMapPanel from './gps-map-panel'

export const dynamic = 'force-dynamic'

async function getGPSData() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const [{ data: checkins }, { data: vendedoresActivos }, { data: clientesConGeo }] = await Promise.all([
    supabase
      .from('gps_checkins')
      .select(`
        id, tipo, latitud, longitud, vendedor_id, cliente_id, created_at,
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
    supabase
      .from('clientes')
      .select('id, razon_social, latitud, longitud')
      .not('latitud', 'is', null)
      .not('longitud', 'is', null)
      .limit(200),
  ])

  const ultimaUbicacion: Record<string, any> = {}
  checkins?.forEach((c: any) => {
    const vid = c.vendedor_id
    if (vid && !ultimaUbicacion[vid]) {
      ultimaUbicacion[vid] = c
    }
  })

  return {
    checkins: (checkins ?? []) as any[],
    vendedoresActivos: vendedoresActivos ?? [],
    ultimaUbicacion,
    clientesConGeo: (clientesConGeo ?? []) as any[],
  }
}

const TIPO_CONFIG: Record<string, { label: string; className: string }> = {
  entrada: { label: 'Entrada', className: 'bg-green-100 text-green-700' },
  salida: { label: 'Salida', className: 'bg-red-100 text-red-700' },
  visita_sin_compra: { label: 'Visita s/compra', className: 'bg-yellow-100 text-yellow-700' },
}

export default async function GPSPage() {
  const { checkins, vendedoresActivos, ultimaUbicacion, clientesConGeo } = await getGPSData()

  const today = new Date().toLocaleDateString('es-PE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Supervisión GPS</h1>
        <p className="text-sm text-gray-500 mt-0.5 capitalize">{today}</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Mapa real */}
        <div className="xl:col-span-2">
          <GpsMapPanel checkins={checkins} clientes={clientesConGeo} />
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
                vendedoresActivos.map((v: any) => {
                  const ultima = ultimaUbicacion[v.id]
                  const initials = v.full_name?.split(' ').slice(0, 2).map((n: string) => n[0]).join('') ?? '?'
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
                      <div className={`w-2 h-2 rounded-full ${ultima ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
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
                    const mapsLink = c.latitud && c.longitud
                      ? `https://www.openstreetmap.org/?mlat=${c.latitud}&mlon=${c.longitud}&zoom=17`
                      : null
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
                          {mapsLink ? (
                            <a
                              href={mapsLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-green-600 hover:underline"
                            >
                              {Number(c.latitud).toFixed(5)}, {Number(c.longitud).toFixed(5)}
                            </a>
                          ) : '—'}
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
