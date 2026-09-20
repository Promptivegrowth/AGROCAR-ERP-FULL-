/**
 * La caja no debe avisar de cobros pendientes que ya están liquidados.
 *
 * Daniel: "no puedo cerrar la caja del 17 y no se carga a la caja automático".
 *
 * No había nada pendiente: los 43 cobros del 17/09 entraron solos en la sesión
 * del 18/09, que está cerrada. El cartel mentía porque la pantalla traía todos
 * los movimientos de caja para cruzarlos acá, y PostgREST corta en mil filas.
 *
 * Esto entra a la pantalla de verdad y comprueba que el cartel diga lo mismo
 * que la base.
 *
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-caja-pendientes.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3014'

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
const ADMIN = { correo: `zz.caja.${sello}@agrocar.pe`, clave: `Zc-${sello}-t!` }
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log('\nEL CARTEL DE COBROS PENDIENTES\n')

  // La verdad, contada por la base.
  const { data: realesRaw } = await (admin as any).rpc('cobros_sin_liquidar')
  const reales = (realesRaw ?? []) as any[]
  console.log(`  la base dice: ${reales.length} cobros pendientes\n`)

  // Y cuantos movimientos hay, que es lo que rompia el conteo viejo.
  const { count: movs } = await (admin as any).from('caja_movimientos')
    .select('id', { count: 'exact', head: true }).not('cobro_id', 'is', null)
  check('Hay más de mil movimientos con cobro (por eso se truncaba)',
    (movs ?? 0) > 1000, `${movs} movimientos`)

  const { data: creado, error } = await admin.auth.admin.createUser({
    email: ADMIN.correo, password: ADMIN.clave, email_confirm: true,
  })
  if (error) throw error
  const userId = creado.user!.id
  await admin.from('profiles').upsert({
    id: userId, email: ADMIN.correo, full_name: 'ZZ Caja de prueba',
    role: 'administrador', activo: true,
  } as never)

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 1100 })
    await page.emulateTimezone('America/Lima')

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.type('input[type="email"]', ADMIN.correo)
    await page.type('input[type="password"]', ADMIN.clave)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
    await esperar(6000)
    check('Entra al sistema', !page.url().includes('/login'))

    await page.goto(`${BASE}/caja`, { waitUntil: 'networkidle2', timeout: 90000 })
    await esperar(8000)

    const texto = await page.evaluate(() => document.body.innerText)
    check('La caja carga', /Centro financiero|Cobros de hoy/i.test(texto),
      `${texto.length} caracteres`)

    const cartel = texto.match(/Hay (\d+) cobros? sin liquidar[^\n]*/i)
    if (reales.length === 0) {
      check('Ya NO aparece el cartel de pendientes', !cartel,
        cartel ? cartel[0].slice(0, 90) : 'sin cartel, como corresponde')
    } else {
      const n = cartel ? Number(cartel[1]) : 0
      check('El cartel coincide con la base', n === reales.length,
        `cartel ${n}, base ${reales.length}`)
    }

    await page.screenshot({ path: '.sunat/caja-pendientes.png', fullPage: false })
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
    console.log('\n  Usuario temporal eliminado.')
  }

  const bien = resultados.filter(([, ok]) => ok).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
