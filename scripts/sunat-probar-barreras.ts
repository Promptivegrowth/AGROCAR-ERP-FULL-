/**
 * ¿De verdad es imposible mandar algo a producción sin querer?
 *
 * Esta prueba no envía nada a SUNAT. Ejercita la única decisión que importa
 * —contra qué servicio se va a hablar— bajo las cuatro combinaciones posibles
 * de configuración y credenciales, y comprueba que solo una de ellas habilita
 * producción.
 *
 * La configuración del ERP se toca de verdad y se deja como estaba: la
 * restauración va en un `finally`, así que aunque la prueba se caiga a la
 * mitad el sistema vuelve a beta.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/sunat-probar-barreras.ts
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

interface Caso {
  nombre: string
  modoEnConfig: string
  conCredenciales: boolean
  esperado: 'beta' | 'produccion'
}

const CASOS: Caso[] = [
  { nombre: 'Config en beta, sin credenciales', modoEnConfig: 'beta', conCredenciales: false, esperado: 'beta' },
  { nombre: 'Config en beta, CON credenciales', modoEnConfig: 'beta', conCredenciales: true, esperado: 'beta' },
  { nombre: 'Config en produccion, SIN credenciales', modoEnConfig: 'produccion', conCredenciales: false, esperado: 'beta' },
  { nombre: 'Config en produccion, CON credenciales', modoEnConfig: 'produccion', conCredenciales: true, esperado: 'produccion' },
]

async function main() {
  cargarEnvLocal()

  // El certificado va por variable de entorno, igual que en el servidor.
  process.env.SUNAT_CERT_BASE64 = fs.readFileSync(env('CERT_PFX')).toString('base64')
  process.env.SUNAT_CERT_PASSWORD = env('CERT_PASS')

  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
  const { configuracionSunat } = await import('../src/lib/sunat/config')

  const { data: original } = await supabase
    .from('configuracion').select('valor').eq('clave', 'sunat_modo').maybeSingle()
  const modoOriginal = (original as { valor: string } | null)?.valor ?? 'beta'

  console.log('\nPRUEBA DE LAS BARRERAS — no se envía nada a SUNAT\n')
  console.log(`  El sistema está en "${modoOriginal}". Se restaura al terminar.\n`)

  let bien = 0
  try {
    for (const caso of CASOS) {
      await supabase.from('configuracion').update({ valor: caso.modoEnConfig }).eq('clave', 'sunat_modo')

      if (caso.conCredenciales) {
        process.env.SUNAT_USUARIO_SOL = 'USERFAC4'
        process.env.SUNAT_CLAVE_SOL = 'clave-de-prueba-no-real'
      } else {
        delete process.env.SUNAT_USUARIO_SOL
        delete process.env.SUNAT_CLAVE_SOL
      }

      const conf = await configuracionSunat()
      const ok = conf.modo === caso.esperado
      if (ok) bien++
      console.log(`  ${ok ? 'OK  ' : 'MAL '} ${caso.nombre}`)
      console.log(`       esperado ${caso.esperado} · obtenido ${conf.modo}`)
      console.log(`       "${conf.razon}"`)
      console.log()
    }
  } finally {
    await supabase.from('configuracion').update({ valor: modoOriginal }).eq('clave', 'sunat_modo')
    const { data: fin } = await supabase
      .from('configuracion').select('valor').eq('clave', 'sunat_modo').maybeSingle()
    console.log(`  Restaurado a "${(fin as { valor: string } | null)?.valor}".`)
  }

  // Y la última: un certificado vencido no debe poder firmar nada.
  process.env.SUNAT_CERT_PASSWORD = 'clave-incorrecta'
  let rechazoClaveMala = false
  try { await configuracionSunat() } catch { rechazoClaveMala = true }
  console.log(`  ${rechazoClaveMala ? 'OK  ' : 'MAL '} Con la contraseña del certificado equivocada, no arranca`)

  console.log(`\n  ${bien + (rechazoClaveMala ? 1 : 0)} de ${CASOS.length + 1} comprobaciones pasaron.\n`)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
