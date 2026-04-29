import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

async function checkPermisos() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { authorized: false, status: 401, error: 'No autenticado' }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !['gerente', 'administrador'].includes((profile as any).role)) {
    return { authorized: false, status: 403, error: 'No autorizado' }
  }
  return { authorized: true, status: 200, error: null, callerId: user.id }
}

/** Elimina un usuario (auth + profile cascade). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await checkPermisos()
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (params.id === auth.callerId) {
    return NextResponse.json({ error: 'No puedes eliminarte a ti mismo' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.deleteUser(params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

/** Resetea password (PATCH con { password }). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await checkPermisos()
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json()
  const { password } = body
  if (!password || password.length < 6) {
    return NextResponse.json({ error: 'La password debe tener al menos 6 caracteres' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(params.id, { password })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
