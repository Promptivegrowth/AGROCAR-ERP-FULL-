import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types'

const roleRedirects: Record<UserRole, string> = {
  gerente: '/dashboard',
  administrador: '/dashboard',
  facturador: '/facturacion',
  almacenero: '/almacen',
  contador: '/contabilidad',
  vendedor: '/pwa/pedidos',
  repartidor: '/pwa/cobros',
}

export default async function RootPage() {
  const supabase = await createClient()

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()

  if (!profile) {
    redirect('/login')
  }

  const destination = roleRedirects[profile.role as UserRole] ?? '/dashboard'
  redirect(destination)
}
