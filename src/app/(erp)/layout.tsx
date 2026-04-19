import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ErpShell from '@/components/erp/erp-shell'

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
    <ErpShell userRole={profile.role} user={userForTopbar}>
      {children}
    </ErpShell>
  )
}
