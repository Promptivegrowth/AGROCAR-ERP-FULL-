'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Bell,
  ChevronDown,
  LogOut,
  User,
  KeyRound,
  ChevronRight,
  Menu,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn, ROLES_LABELS } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

type Notif = {
  id: string
  msg: string
  href: string
  dot: string
}

interface TopbarUser {
  full_name: string
  role: string
  email: string
}

interface TopbarProps {
  user: TopbarUser
  onMenuClick?: () => void
}

const BREADCRUMB_MAP: Record<string, string> = {
  dashboard: 'Dashboard',
  maestros: 'Maestros',
  clientes: 'Clientes',
  productos: 'Productos',
  proveedores: 'Proveedores',
  vehiculos: 'Vehículos',
  zonas: 'Zonas',
  almacen: 'Almacén',
  compras: 'Compras',
  ajustes: 'Ajustes',
  despacho: 'Despacho',
  facturacion: 'Facturación',
  cobranzas: 'Cobranzas',
  gps: 'GPS',
  reportes: 'Reportes',
  contabilidad: 'Contabilidad',
  configuracion: 'Configuración',
}

export default function Topbar({ user, onMenuClick }: TopbarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [loadingNotifs, setLoadingNotifs] = useState(false)

  const supabase = createClient()

  // Cargar notificaciones reales al montar y cuando se abren
  useEffect(() => {
    let cancel = false
    const cargarNotifs = async () => {
      setLoadingNotifs(true)
      const result: Notif[] = []
      const sb = supabase as any

      const [
        { count: pedidosPend },
        { count: solicPend },
        { count: cobrosNoConc },
        { data: lotesVenc },
        { data: stockBajo },
      ] = await Promise.all([
        sb.from('pedidos').select('id', { count: 'exact', head: true }).eq('estado', 'enviado'),
        sb.from('solicitudes_cliente').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
        sb.from('cobros').select('id', { count: 'exact', head: true }).eq('conciliado', false),
        sb.from('lotes')
          .select('id, fecha_vencimiento, productos(nombre, descripcion)')
          .eq('activo', true)
          .gt('cantidad_actual', 0)
          .lte('fecha_vencimiento', new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0])
          .limit(3),
        sb.from('v_stock_alertas')
          .select('codigo, nombre, descripcion, estado_stock, stock_actual, stock_minimo')
          .eq('estado_stock', 'bajo_minimo')
          .limit(3),
      ])

      if (pedidosPend && pedidosPend > 0) {
        result.push({
          id: 'ped',
          msg: `${pedidosPend} pedido${pedidosPend === 1 ? '' : 's'} pendiente${pedidosPend === 1 ? '' : 's'} de facturar`,
          href: '/facturacion',
          dot: 'bg-yellow-400',
        })
      }
      if (solicPend && solicPend > 0) {
        result.push({
          id: 'sol',
          msg: `${solicPend} solicitud${solicPend === 1 ? '' : 'es'} de cliente esperando revisión`,
          href: '/solicitudes-cliente',
          dot: 'bg-amber-400',
        })
      }
      if (cobrosNoConc && cobrosNoConc > 0) {
        result.push({
          id: 'cob',
          msg: `${cobrosNoConc} cobro${cobrosNoConc === 1 ? '' : 's'} por conciliar`,
          href: '/cobranzas',
          dot: 'bg-red-400',
        })
      }
      ;(stockBajo ?? []).forEach((s: any, i: number) => {
        const label = s.descripcion?.trim() || s.nombre
        result.push({
          id: `stk-${i}`,
          msg: `Stock bajo: ${label} (${s.stock_actual} / mín ${s.stock_minimo})`,
          href: '/almacen',
          dot: 'bg-orange-400',
        })
      })
      ;(lotesVenc ?? []).forEach((l: any, i: number) => {
        const label = l.productos?.descripcion?.trim() || l.productos?.nombre || '—'
        result.push({
          id: `lot-${i}`,
          msg: `Lote por vencer: ${label} (${l.fecha_vencimiento})`,
          href: '/almacen/lotes',
          dot: 'bg-purple-400',
        })
      })

      if (!cancel) {
        setNotifs(result)
        setLoadingNotifs(false)
      }
    }

    cargarNotifs()
    // Refrescar cada 60s
    const intv = setInterval(cargarNotifs, 60000)
    return () => { cancel = true; clearInterval(intv) }
  }, [])

  const segments = pathname.split('/').filter(Boolean)
  const breadcrumbs = segments.map((seg) => BREADCRUMB_MAP[seg] ?? seg)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const initials = user.full_name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 flex-shrink-0 z-10 print:hidden">
      {/* Hamburger + Breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Abrir menú"
        >
          <Menu className="w-5 h-5 text-gray-600" />
        </button>
        <nav className="flex items-center gap-1 text-sm text-gray-500 min-w-0">
          <span className="text-gray-400 hidden sm:inline">AGROCAR</span>
          {breadcrumbs.map((crumb, idx) => (
            <span key={idx} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0 hidden sm:inline" />
              <span
                className={cn(
                  'truncate',
                  idx === breadcrumbs.length - 1
                    ? 'text-gray-800 font-semibold'
                    : 'text-gray-500 hidden sm:inline'
                )}
              >
                {crumb}
              </span>
            </span>
          ))}
        </nav>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => { setNotifOpen(!notifOpen); setDropdownOpen(false) }}
            className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Bell className="w-5 h-5 text-gray-500" />
            {notifs.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </button>

          {notifOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
              <div className="absolute right-0 mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden max-h-[480px] flex flex-col">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                  <p className="font-semibold text-sm text-gray-800">Notificaciones</p>
                  {notifs.length > 0 && (
                    <Badge variant="secondary" className="text-xs">{notifs.length} {notifs.length === 1 ? 'nueva' : 'nuevas'}</Badge>
                  )}
                </div>
                <div className="divide-y divide-gray-50 overflow-y-auto">
                  {loadingNotifs ? (
                    <p className="text-xs text-gray-400 text-center py-6">Cargando...</p>
                  ) : notifs.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-6">No hay alertas pendientes</p>
                  ) : (
                    notifs.map((n) => (
                      <Link
                        key={n.id}
                        href={n.href}
                        onClick={() => setNotifOpen(false)}
                        className="block px-4 py-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <span className={cn('mt-1.5 w-2 h-2 rounded-full flex-shrink-0', n.dot)} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-700 break-words">{n.msg}</p>
                          </div>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* User dropdown */}
        <div className="relative">
          <button
            onClick={() => { setDropdownOpen(!dropdownOpen); setNotifOpen(false) }}
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-[#FBE600] flex items-center justify-center">
              <span className="text-black text-xs font-bold">{initials}</span>
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium text-gray-800 leading-none">{user.full_name}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{ROLES_LABELS[user.role] ?? user.role}</p>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>

          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
              <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-800 truncate">{user.full_name}</p>
                  <p className="text-xs text-gray-400 truncate">{user.email}</p>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => { router.push('/configuracion/perfil'); setDropdownOpen(false) }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <User className="w-4 h-4 text-gray-400" />
                    Mi Perfil
                  </button>
                  <button
                    onClick={() => { router.push('/configuracion/cambiar-password'); setDropdownOpen(false) }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <KeyRound className="w-4 h-4 text-gray-400" />
                    Cambiar Contraseña
                  </button>
                </div>
                <div className="py-1 border-t border-gray-100">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Cerrar Sesión
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
