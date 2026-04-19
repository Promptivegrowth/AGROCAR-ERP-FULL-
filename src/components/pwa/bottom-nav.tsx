'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShoppingCart, Users, DollarSign, MapPin, User } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/pwa/pedidos', label: 'Pedidos', icon: ShoppingCart },
  { href: '/pwa/clientes', label: 'Clientes', icon: Users },
  { href: '/pwa/cobros', label: 'Cobros', icon: DollarSign },
  { href: '/pwa/checkin', label: 'Check-in', icon: MapPin },
  { href: '/pwa/cuenta', label: 'Cuenta', icon: User },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] rounded-t-2xl">
      <div className="flex items-center justify-around px-1 py-2 safe-bottom">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href)

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-all min-w-[56px]',
                isActive
                  ? 'bg-green-50 text-green-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              )}
            >
              <Icon
                className={cn(
                  'w-5 h-5 transition-colors',
                  isActive ? 'text-green-600' : 'text-gray-400'
                )}
              />
              <span
                className={cn(
                  'text-[10px] font-medium leading-none transition-colors',
                  isActive ? 'text-green-700' : 'text-gray-500'
                )}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
