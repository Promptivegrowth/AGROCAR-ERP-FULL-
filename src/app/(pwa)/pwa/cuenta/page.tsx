'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { User, LogOut, ShoppingCart, DollarSign, MapPin, Package, Loader2, TrendingUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'
import type { Profile } from '@/types'

interface ResumenDia {
  pedidosEnviados: number
  montoTotalPedidos: number
  cobrosRegistrados: number
  montoTotalCobros: number
  clientesVisitados: number
  clientesProgramadosHoy: number
}

interface ComisionMes {
  porcentaje: number  // promedio si hay varias familias
  monto_base: number  // total ventas (facturado real)
  comision_calculada: number
  meta: number | null
  porcentaje_meta: number | null
  desglose?: Array<{
    familia_nombre: string
    monto_ventas: number
    porcentaje_promedio: number | null
    monto_comision: number
    tiene_regla: boolean
  }>
  lineas_sin_regla?: number
}

export default function CuentaPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [zona, setZona] = useState<string | null>(null)
  const [resumen, setResumen] = useState<ResumenDia | null>(null)
  const [comision, setComision] = useState<ComisionMes | null>(null)
  const [loading, setLoading] = useState(true)
  const [cerrando, setCerrando] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      // Cargar perfil
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*, zonas!profiles_zona_id_fkey(nombre)')
        .eq('id', user.id)
        .single()

      if (profileData) {
        setProfile(profileData as Profile)
        setZona((profileData as Profile & { zonas?: { nombre?: string } }).zonas?.nombre ?? null)
      }

      // Resumen del día
      const hoy = hoyLima()

      const JS_DAY_TO_KEY = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']
      const diaHoy = JS_DAY_TO_KEY[new Date().getDay()]

      const [{ data: pedidos }, { data: cobros }, { data: checkins }, { data: programados }] = await Promise.all([
        supabase
          .from('pedidos')
          .select('total')
          .eq('vendedor_id', user.id)
          .gte('created_at', hoy),
        supabase
          .from('cobros')
          .select('total')
          .eq('cobrador_id', user.id)
          .gte('created_at', hoy),
        supabase
          .from('gps_checkins')
          .select('cliente_id')
          .eq('usuario_id', user.id)
          .eq('tipo', 'entrada')
          .gte('created_at', hoy),
        (supabase as any)
          .from('clientes')
          .select('id')
          .eq('vendedor_id', user.id)
          .eq('estado', 'activo')
          .contains('dias_visita', [diaHoy]),
      ])

      const clientesUnicosDia = new Set(checkins?.map((c) => c.cliente_id) ?? []).size
      const montoPedidos = pedidos?.reduce((acc, p) => acc + ((p as { total?: number }).total ?? 0), 0) ?? 0
      const montoCobros = cobros?.reduce((acc, c) => acc + ((c as { total?: number }).total ?? 0), 0) ?? 0

      setResumen({
        pedidosEnviados: pedidos?.length ?? 0,
        montoTotalPedidos: montoPedidos,
        cobrosRegistrados: cobros?.length ?? 0,
        montoTotalCobros: montoCobros,
        clientesVisitados: clientesUnicosDia,
        clientesProgramadosHoy: programados?.length ?? 0,
      })

      // Comisiones del mes con desglose por familia (nueva RPC)
      const inicioMes = new Date()
      inicioMes.setDate(1)
      const inicioMesStr = inicioMes.toISOString().split('T')[0]
      const finMes = new Date()
      finMes.setMonth(finMes.getMonth() + 1)
      finMes.setDate(0)
      const finMesStr = finMes.toISOString().split('T')[0]

      const { data: rpcCom } = await (supabase.rpc as any)(
        'calcular_comision_vendedor',
        { p_vendedor_id: user.id, p_desde: inicioMesStr, p_hasta: finMesStr },
      )

      // Meta del mes (si existe)
      const { data: metaRow } = await (supabase as any)
        .from('metas_vendedor')
        .select('monto_meta')
        .eq('vendedor_id', user.id)
        .eq('periodo', 'mensual')
        .eq('anio', inicioMes.getFullYear())
        .eq('mes', inicioMes.getMonth() + 1)
        .maybeSingle()
      const meta = metaRow ? Number(metaRow.monto_meta ?? 0) : null

      if (rpcCom) {
        const ventas = Number(rpcCom.total_ventas ?? 0)
        const comision = Number(rpcCom.total_comision ?? 0)
        const desglose = (rpcCom.desglose ?? []) as any[]
        // Porcentaje promedio ponderado
        const pct = ventas > 0 ? (comision / ventas) * 100 : 0
        setComision({
          porcentaje: pct,
          monto_base: ventas,
          comision_calculada: comision,
          meta,
          porcentaje_meta: meta ? Math.round((ventas / meta) * 100) : null,
          desglose: desglose.map((d) => ({
            familia_nombre: d.familia_nombre,
            monto_ventas: Number(d.monto_ventas ?? 0),
            porcentaje_promedio: d.porcentaje_promedio !== null ? Number(d.porcentaje_promedio) : null,
            monto_comision: Number(d.monto_comision ?? 0),
            tiene_regla: !!d.tiene_regla,
          })),
          lineas_sin_regla: Number(rpcCom.lineas_sin_regla ?? 0),
        })
      }

      setLoading(false)
    }

    init()
  }, [])

  async function cerrarSesion() {
    setCerrando(true)
    const { error } = await supabase.auth.signOut()
    if (error) {
      setCerrando(false)
      toast.error('Error al cerrar sesión', { description: error.message })
      return
    }
    toast.success('Sesión cerrada', { description: 'Hasta pronto.' })
    router.push('/login')
  }

  const rolesLabels: Record<string, string> = {
    gerente: 'Gerente',
    administrador: 'Administrador',
    facturador: 'Facturador',
    almacenero: 'Almacenero',
    vendedor: 'Vendedor',
    repartidor: 'Repartidor',
    contador: 'Contador',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-gray-600" />
      </div>
    )
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="bg-black text-white px-4 pt-6 pb-8 border-b-4 border-[#FBE600]">
        <div className="flex items-center justify-end mb-3">
          <Image src="/logo-agrocar.png" alt="AGROCAR" width={120} height={32} className="object-contain" />
        </div>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-[#FBE600] rounded-2xl flex items-center justify-center">
            <User className="w-9 h-9 text-black" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{profile?.full_name ?? 'Usuario'}</h1>
            <div className="text-gray-300 text-sm">{rolesLabels[profile?.role ?? ''] ?? profile?.role}</div>
            {zona && <div className="text-gray-400 text-xs mt-0.5">Zona: {zona}</div>}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4 -mt-4">
        {/* Resumen del día */}
        {resumen && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-600" />
                Resumen de Hoy
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 rounded-xl p-3 text-center">
                  <div className="flex justify-center mb-1">
                    <ShoppingCart className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="text-2xl font-bold text-blue-700">{resumen.pedidosEnviados}</div>
                  <div className="text-xs text-blue-600 font-medium">Pedidos</div>
                  <div className="text-xs text-blue-500 mt-0.5">{formatCurrency(resumen.montoTotalPedidos)}</div>
                </div>

                <div className="bg-green-50 rounded-xl p-3 text-center">
                  <div className="flex justify-center mb-1">
                    <DollarSign className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="text-2xl font-bold text-green-700">{resumen.cobrosRegistrados}</div>
                  <div className="text-xs text-green-600 font-medium">Cobros</div>
                  <div className="text-xs text-green-500 mt-0.5">{formatCurrency(resumen.montoTotalCobros)}</div>
                </div>

                <div className="bg-purple-50 rounded-xl p-3 text-center">
                  <div className="flex justify-center mb-1">
                    <MapPin className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="text-2xl font-bold text-purple-700">{resumen.clientesVisitados}</div>
                  <div className="text-xs text-purple-600 font-medium">Visitas</div>
                  <div className="text-xs text-purple-400 mt-0.5">clientes</div>
                </div>
              </div>

              {/* Programados hoy */}
              {resumen.clientesProgramadosHoy > 0 && (
                <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📅</span>
                    <div>
                      <p className="text-xs font-semibold text-yellow-900">Agenda de hoy</p>
                      <p className="text-[11px] text-yellow-800">
                        {resumen.clientesProgramadosHoy} cliente{resumen.clientesProgramadosHoy === 1 ? '' : 's'} programado{resumen.clientesProgramadosHoy === 1 ? '' : 's'}
                        {' · '}{resumen.clientesVisitados} visitado{resumen.clientesVisitados === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>
                  <span className="text-xl font-bold text-yellow-900">
                    {resumen.clientesProgramadosHoy > 0
                      ? `${Math.min(100, Math.round((resumen.clientesVisitados / resumen.clientesProgramadosHoy) * 100))}%`
                      : '—'}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Comisiones del mes */}
        {comision && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Package className="w-4 h-4 text-green-600" />
                Comisiones del Mes
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Ventas del mes</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(comision.monto_base)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    Promedio {comision.porcentaje.toFixed(2)}% (por familia)
                  </span>
                  <span className="font-semibold text-green-700">{formatCurrency(comision.comision_calculada)}</span>
                </div>

                {/* Desglose por familia */}
                {comision.desglose && comision.desglose.length > 0 && (
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-2 -mx-1">
                    <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1.5">
                      Desglose por familia
                    </p>
                    <div className="divide-y divide-gray-200">
                      {comision.desglose.map((d, i) => (
                        <div key={i} className="flex items-center justify-between py-1 text-xs">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-800 truncate">{d.familia_nombre}</p>
                            <p className="text-[10px] text-gray-500">
                              {formatCurrency(d.monto_ventas)}
                              {d.porcentaje_promedio !== null
                                ? ` · ${d.porcentaje_promedio.toFixed(2)}%`
                                : ' · sin regla'}
                            </p>
                          </div>
                          <span className={`font-mono font-bold text-xs ${
                            d.tiene_regla ? 'text-green-700' : 'text-gray-400'
                          }`}>
                            {formatCurrency(d.monto_comision)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {comision.lineas_sin_regla && comision.lineas_sin_regla > 0 ? (
                      <p className="text-[9px] text-amber-700 mt-1 italic">
                        ⚠ {comision.lineas_sin_regla} líneas sin regla configurada
                      </p>
                    ) : null}
                  </div>
                )}
                {comision.meta && (
                  <div>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-gray-600">Meta mensual</span>
                      <span className="text-gray-700">{comision.porcentaje_meta}% ({formatCurrency(comision.meta)})</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${Math.min(comision.porcentaje_meta ?? 0, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="pt-2 border-t border-gray-100 flex justify-between">
                  <span className="font-semibold text-gray-800">Comisión estimada</span>
                  <span className="font-bold text-green-700 text-lg">{formatCurrency(comision.comision_calculada)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Datos de contacto */}
        {profile?.email && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <h3 className="font-semibold text-gray-800 mb-2">Datos de Cuenta</h3>
              <div className="text-sm text-gray-600">
                <div className="flex justify-between py-1.5 border-b border-gray-50">
                  <span>Correo</span>
                  <span className="text-gray-900 font-medium">{profile.email}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-gray-50">
                  <span>Rol</span>
                  <span className="text-gray-900 font-medium">{rolesLabels[profile.role] ?? profile.role}</span>
                </div>
                {zona && (
                  <div className="flex justify-between py-1.5">
                    <span>Zona</span>
                    <span className="text-gray-900 font-medium">{zona}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Mi Reporte (historial + descargas) */}
        <Button
          onClick={() => router.push('/pwa/mi-reporte')}
          variant="outline"
          className="w-full h-12 border-gray-200 text-gray-800 hover:bg-gray-50 font-semibold"
        >
          <TrendingUp className="w-4 h-4" />
          Mi Reporte (historial + Excel/PDF)
        </Button>

        {/* Cerrar sesión */}
        <Button
          onClick={cerrarSesion}
          disabled={cerrando}
          variant="outline"
          className="w-full h-12 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 font-semibold"
        >
          {cerrando ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Cerrando sesión...
            </>
          ) : (
            <>
              <LogOut className="w-4 h-4" />
              Cerrar Sesión
            </>
          )}
        </Button>

        <div className="text-center text-xs text-gray-400 pb-2">
          AGROCAR ERP v1.0 · AGROCAR S.R.L. · Tacna, Perú
        </div>
      </div>
    </div>
  )
}
