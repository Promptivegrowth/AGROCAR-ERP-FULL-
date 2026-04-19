import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/erp/sidebar'
import Topbar from '@/components/erp/topbar'

export default async function ERPLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    redirect('/login')
  }

  if (!profile.activo) {
    redirect('/login?error=account_inactive')
  }

  const userForTopbar = {
    full_name: profile.full_name ?? user.email ?? 'Usuario',
    role: profile.role,
    email: profile.email,
  }

  return (
    <div className="flex h-screen bg-[#f9fafb] overflow-hidden">
      {/* Sidebar fijo */}
      <Sidebar userRole={profile.role} />

      {/* Contenido principal */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Topbar */}
        <Topbar user={userForTopbar} />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
