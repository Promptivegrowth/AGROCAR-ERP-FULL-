/**
 * Reproducir el error al cambiar el rol de un usuario.
 *
 * Daniel: "cuando editas haces cambio de rol no guarda, sale error".
 *
 * Se hace exactamente lo que hace la pantalla: un UPDATE sobre `profiles` con
 * la sesión de un administrador. Dos usuarios temporales —el que edita y el
 * editado— que se borran al terminar, pase lo que pase.
 *
 *   npx tsx scripts/reproducir-error-cambio-rol.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

function cargarEnvLocal() {
  const f = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(f)) return
  for (const linea of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const env = (n: string) => {
  const v = process.env[n]
  if (!v) throw new Error(`Falta ${n}`)
  return v
}

const sello = Date.now()
const ADMIN = { correo: `prueba.admin.${sello}@agrocar.pe`, clave: `Pa-${sello}-tmp!` }
const BLANCO = { correo: `prueba.blanco.${sello}@agrocar.pe`, clave: `Pb-${sello}-tmp!` }

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
  const url = env('NEXT_PUBLIC_SUPABASE_URL')
  const anon = env('NEXT_PUBLIC_SUPABASE_ANON_KEY')

  console.log('\nCAMBIAR EL ROL DE UN USUARIO\n')

  const creados: string[] = []
  try {
    const crear = async (u: { correo: string; clave: string }, rol: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: u.correo, password: u.clave, email_confirm: true,
      })
      if (error) throw error
      const id = data.user!.id
      creados.push(id)
      await admin.from('profiles').upsert({
        id, email: u.correo, full_name: `Prueba ${rol}`, role: rol, activo: true,
      } as never)
      return id
    }

    const idAdmin = await crear(ADMIN, 'administrador')
    const idBlanco = await crear(BLANCO, 'vendedor')
    console.log(`  administrador de prueba: ${idAdmin}`)
    console.log(`  usuario a editar:        ${idBlanco} (vendedor)\n`)

    const sesion = await admin.auth.signInWithPassword({
      email: ADMIN.correo, password: ADMIN.clave,
    })
    const token = sesion.data.session?.access_token
    if (!token) throw new Error('el administrador de prueba no pudo iniciar sesión')

    // Exactamente lo que manda la pantalla.
    const cuerpo = {
      full_name: 'Prueba vendedor',
      role: 'almacenero',
      activo: true,
      codigo: null,
      dni: null,
      telefono: null,
      zona_id: null,
      updated_at: new Date().toISOString(),
    }

    const res = await fetch(`${url}/rest/v1/profiles?id=eq.${idBlanco}`, {
      method: 'PATCH',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(cuerpo),
    })
    const texto = await res.text()

    console.log(`  respuesta: HTTP ${res.status}`)
    console.log(`  cuerpo:    ${texto.slice(0, 500)}\n`)

    const { data: despues } = await (admin as any).from('profiles')
      .select('role, full_name').eq('id', idBlanco).maybeSingle()
    console.log(`  el rol quedó en: ${(despues as any)?.role}`)
    console.log(`  se esperaba:     almacenero\n`)

    if ((despues as any)?.role === 'almacenero') {
      console.log('  → El cambio SÍ se guardó. El error está en otro lado.')
    } else {
      console.log('  → REPRODUCIDO: el rol no cambió.')
    }
  } finally {
    for (const id of creados) {
      await admin.from('profiles').delete().eq('id', id)
      await admin.auth.admin.deleteUser(id)
    }
    console.log('\n  Usuarios temporales eliminados.')
  }
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
