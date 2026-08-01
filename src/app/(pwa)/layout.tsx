import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import BottomNav from '@/components/pwa/bottom-nav'

export default async function PWALayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, activo')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.activo) {
    redirect('/login')
  }

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      {/* Main content with scroll */}
      <main className="flex-1 overflow-y-auto pb-20">
        {children}
      </main>

      {/* Fixed bottom navigation */}
      <BottomNav role={profile.role as string} />
    </div>
  )
}
