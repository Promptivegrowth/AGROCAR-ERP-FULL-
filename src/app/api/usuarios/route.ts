import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * Crea un nuevo usuario (auth.users + profiles).
 * Solo gerente/administrador pueden invocar.
 */
export async function POST(req: NextRequest) {
  // Validar permisos del que llama
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !['gerente', 'administrador'].includes((profile as any).role)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const body = await req.json()
  const {
    email,
    password,
    full_name,
    role,
    codigo,
    dni,
    telefono,
    zona_id,
    zona_ids,    // ← array de zonas adicionales (M:N)
    activo = true,
  } = body

  if (!email || !password || !full_name || !role) {
    return NextResponse.json({ error: 'email, password, full_name y role son obligatorios' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 1. Crear en auth.users
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: String(email).trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })
  if (authErr || !authData.user) {
    return NextResponse.json({ error: authErr?.message ?? 'No se pudo crear el usuario' }, { status: 400 })
  }

  const newUserId = authData.user.id

  // 2. Upsert profile (puede que el handle_new_user trigger ya lo haya creado)
  const { error: profErr } = await (admin as any).from('profiles').upsert({
    id: newUserId,
    email: String(email).trim().toLowerCase(),
    full_name,
    role,
    codigo: codigo?.trim() || null,
    dni: dni?.trim() || null,
    telefono: telefono?.trim() || null,
    zona_id: zona_id || null,
    activo,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })

  if (profErr) {
    // Rollback: eliminar el auth user creado
    await admin.auth.admin.deleteUser(newUserId)
    return NextResponse.json({ error: `Error en perfil: ${profErr.message}` }, { status: 400 })
  }

  // Sincronizar zonas (M:N)
  const zonasFinales = Array.isArray(zona_ids) ? zona_ids : (zona_id ? [zona_id] : [])
  if (zonasFinales.length > 0) {
    await (admin as any).from('profile_zonas').insert(
      zonasFinales.map((z: string) => ({ profile_id: newUserId, zona_id: z }))
    )
  }

  return NextResponse.json({ id: newUserId, email, full_name, role })
}
