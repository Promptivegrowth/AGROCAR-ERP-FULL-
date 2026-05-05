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

  // Validar duplicados ANTES de crear (mensajes claros)
  const emailNorm = String(email).trim().toLowerCase()
  const codigoNorm = codigo?.trim() || null
  const dniNorm = dni?.trim() || null

  const { data: existentes } = await (admin as any)
    .from('profiles')
    .select('email, codigo, dni, full_name')
    .or([
      `email.eq.${emailNorm}`,
      codigoNorm ? `codigo.eq.${codigoNorm}` : null,
      dniNorm ? `dni.eq.${dniNorm}` : null,
    ].filter(Boolean).join(','))

  if (existentes && existentes.length > 0) {
    const e = existentes[0]
    if (e.email === emailNorm) {
      return NextResponse.json({ error: `El email ${emailNorm} ya está registrado para "${e.full_name}".` }, { status: 409 })
    }
    if (codigoNorm && e.codigo === codigoNorm) {
      return NextResponse.json({ error: `El código "${codigoNorm}" ya está asignado a "${e.full_name}". Usa otro.` }, { status: 409 })
    }
    if (dniNorm && e.dni === dniNorm) {
      return NextResponse.json({ error: `El DNI ${dniNorm} ya está registrado para "${e.full_name}".` }, { status: 409 })
    }
  }

  // 1. Crear en auth.users
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: emailNorm,
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
    email: emailNorm,
    full_name,
    role,
    codigo: codigoNorm,
    dni: dniNorm,
    telefono: telefono?.trim() || null,
    zona_id: zona_id || null,
    activo,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })

  if (profErr) {
    // Rollback: eliminar el auth user creado
    await admin.auth.admin.deleteUser(newUserId)
    // Mensajes amigables para errores de constraint
    let msg = profErr.message ?? 'Error al crear el perfil'
    if (msg.includes('profiles_codigo_unique')) msg = `El código "${codigoNorm}" ya está en uso por otro usuario.`
    else if (msg.includes('profiles_dni_unique')) msg = `El DNI ${dniNorm} ya está registrado.`
    else if (msg.includes('profiles_email_unique')) msg = `El email ${emailNorm} ya está registrado.`
    return NextResponse.json({ error: msg }, { status: 400 })
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
