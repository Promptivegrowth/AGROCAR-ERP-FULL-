'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  Database,
  Warehouse,
  Truck,
  FileText,
  DollarSign,
  MapPin,
  BarChart3,
  BookOpen,
  Settings,
  ChevronDown,
  ChevronRight,
  Leaf,
  Users,
  Package,
  Building2,
  Car,
  Map,
  Tags,
  ShoppingCart,
  ClipboardList,
  RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  href?: string
  icon: React.ElementType
  roles?: string[]
  children?: {
    label: string
    href: string
    icon: React.ElementType
    roles?: string[]
  }[]
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'Maestros',
    icon: Database,
    children: [
      { label: 'Clientes', href: '/maestros/clientes', icon: Users },
      { label: 'Productos', href: '/maestros/productos', icon: Package },
      { label: 'Familias', href: '/maestros/familias', icon: Tags },
      { label: 'Proveedores', href: '/maestros/proveedores', icon: Building2 },
      { label: 'Vehículos', href: '/maestros/vehiculos', icon: Car },
      { label: 'Zonas', href: '/maestros/zonas', icon: Map },
    ],
  },
  {
    label: 'Almacén',
    icon: Warehouse,
    children: [
      { label: 'Inventario', href: '/almacen', icon: ClipboardList },
      { label: 'Compras', href: '/almacen/compras', icon: ShoppingCart },
      { label: 'Ajustes', href: '/almacen/ajustes', icon: RotateCcw },
    ],
  },
  {
    label: 'Despacho',
    href: '/despacho',
    icon: Truck,
  },
  {
    label: 'Facturación',
    href: '/facturacion',
    icon: FileText,
    roles: ['gerente', 'administrador', 'facturador'],
  },
  {
    label: 'Cobranzas',
    href: '/cobranzas',
    icon: DollarSign,
  },
  {
    label: 'GPS',
    href: '/gps',
    icon: MapPin,
    roles: ['gerente', 'administrador'],
  },
  {
    label: 'Reportes',
    href: '/reportes',
    icon: BarChart3,
    roles: ['gerente', 'administrador', 'contador'],
  },
  {
    label: 'Contabilidad',
    href: '/contabilidad',
    icon: BookOpen,
    roles: ['gerente', 'contador'],
  },
  {
    label: 'Configuración',
    href: '/configuracion',
    icon: Settings,
    roles: ['gerente', 'administrador'],
  },
]

interface SidebarProps {
  userRole: string
  onNavigate?: () => void
}

export default function Sidebar({ userRole, onNavigate }: SidebarProps) {
  const pathname = usePathname()
  const [openMenus, setOpenMenus] = useState<string[]>(['Maestros', 'Almacén'])

  const toggleMenu = (label: string) => {
    setOpenMenus((prev) =>
      prev.includes(label) ? prev.filter((m) => m !== label) : [...prev, label]
    )
  }

  const isAllowed = (roles?: string[]) => {
    if (!roles || roles.length === 0) return true
    return roles.includes(userRole)
  }

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <aside className="w-[260px] h-dvh bg-white border-r border-gray-200 flex flex-col shadow-sm flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-100">
        <div className="flex items-center justify-center w-9 h-9 bg-green-600 rounded-lg shadow">
          <Leaf className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900 leading-none">AGROCAR ERP</p>
          <p className="text-[10px] text-gray-400 mt-0.5">AGROCAR SRL</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          if (!isAllowed(item.roles)) return null

          if (item.children) {
            const isOpen = openMenus.includes(item.label)
            const hasActiveChild = item.children.some(
              (child) => isAllowed(child.roles) && isActive(child.href)
            )

            return (
              <div key={item.label}>
                <button
                  onClick={() => toggleMenu(item.label)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors group',
                    hasActiveChild
                      ? 'bg-green-50 text-green-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  )}
                >
                  <span className="flex items-center gap-3">
                    <item.icon
                      className={cn(
                        'w-4 h-4',
                        hasActiveChild ? 'text-green-600' : 'text-gray-400 group-hover:text-gray-600'
                      )}
                    />
                    {item.label}
                  </span>
                  {isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                  )}
                </button>

                {isOpen && (
                  <div className="mt-0.5 ml-4 pl-3 border-l border-gray-100 space-y-0.5">
                    {item.children.map((child) => {
                      if (!isAllowed(child.roles)) return null
                      const active = isActive(child.href)
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onNavigate}
                          className={cn(
                            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                            active
                              ? 'bg-green-600 text-white font-medium shadow-sm'
                              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                          )}
                        >
                          <child.icon className={cn('w-3.5 h-3.5', active ? 'text-white' : 'text-gray-400')} />
                          {child.label}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }

          const active = isActive(item.href!)
          return (
            <Link
              key={item.href}
              href={item.href!}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors group',
                active
                  ? 'bg-green-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <item.icon
                className={cn(
                  'w-4 h-4',
                  active ? 'text-white' : 'text-gray-400 group-hover:text-gray-600'
                )}
              />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-100">
        <p className="text-[10px] text-gray-400 text-center">v1.0.0 — Tacna, Perú</p>
      </div>
    </aside>
  )
}
