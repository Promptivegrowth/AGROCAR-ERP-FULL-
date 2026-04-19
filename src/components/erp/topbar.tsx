'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
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

  const supabase = createClient()

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
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 flex-shrink-0 z-10">
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
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
          </button>

          {notifOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
              <div className="absolute right-0 mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <p className="font-semibold text-sm text-gray-800">Notificaciones</p>
                  <Badge variant="secondary" className="text-xs">3 nuevas</Badge>
                </div>
                <div className="divide-y divide-gray-50">
                  {[
                    { msg: '5 pedidos pendientes de facturar', time: 'hace 10 min', dot: 'bg-yellow-400' },
                    { msg: '2 cobros por conciliar', time: 'hace 25 min', dot: 'bg-red-400' },
                    { msg: 'Stock bajo: Salchicha Frankfurt', time: 'hace 1 h', dot: 'bg-orange-400' },
                  ].map((n, i) => (
                    <div key={i} className="px-4 py-3 hover:bg-gray-50 cursor-pointer">
                      <div className="flex items-start gap-3">
                        <span className={cn('mt-1.5 w-2 h-2 rounded-full flex-shrink-0', n.dot)} />
                        <div>
                          <p className="text-sm text-gray-700">{n.msg}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{n.time}</p>
                        </div>
                      </div>
                    </div>
                  ))}
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
            <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">{initials}</span>
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
