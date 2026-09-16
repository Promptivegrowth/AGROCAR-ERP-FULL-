/**
 * Movimientos del día tiene que dejar ver el reparto de mañana.
 *
 * Daniel lo pidió: "por favor puedes desactivar la fecha de los movimientos del
 * día; hoy 15 está desactivado, pero una vez ya emitida la facturación para el
 * día de mañana también necesito ver del 16".
 *
 * Ahora mismo hay 45 comprobantes fechados 16/09 —ya facturados— que el
 * almacenero no podía ver porque el calendario no dejaba pasar de hoy.
 *
 * Esto entra con un navegador, aprieta el botón nuevo y comprueba que el
 * consolidado de mañana aparezca con datos.
 *
 *   BASE=http://localhost:3010 npx tsx scripts/verificar-movimientos-manana.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3010'

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

const CORREO = `verificacion.movimientos.${Date.now()}@agrocar.pe`
const CLAVE = `Vm-${Date.now()}-tmp!`
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const LIMA = 5 * 60 * 60 * 1000
const hoyLima = () => new Date(Date.now() - LIMA).toISOString().slice(0, 10)
const mananaLima = () => {
  const d = new Date(`${hoyLima()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  const hoy = hoyLima()
  const manana = mananaLima()
  console.log(`\nMOVIMIENTOS DEL DÍA: VER EL REPARTO DE MAÑANA\n`)
  console.log(`  Hoy es ${hoy}, mañana ${manana}.\n`)

  // Cuánto hay realmente para mañana, para poder contrastar.
  const { data: esperado } = await (admin as any).from('comprobantes')
    .select('id, total').eq('fecha_despacho', manana).neq('estado', 'anulado')
  const cuantos = (esperado ?? []).length
  check('Hay comprobantes facturados para mañana', cuantos > 0, `${cuantos} comprobantes`)

  const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
    email: CORREO, password: CLAVE, email_confirm: true,
  })
  if (errCrear) throw errCrear
  const userId = creado.user!.id
  await admin.from('profiles').upsert({
    id: userId, email: CORREO, full_name: 'Verificación movimientos',
    role: 'administrador', activo: true,
  } as never)

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 1000 })

    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`[pageerror] ${(e as Error).message}`))
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()) })

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.type('input[type="email"]', CORREO)
    await page.type('input[type="password"]', CLAVE)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
    await esperar(6000)
    check('Entra al sistema', !page.url().includes('/login'), page.url().replace(BASE, ''))

    await page.goto(`${BASE}/almacen/movimientos-dia`, { waitUntil: 'networkidle2', timeout: 90000 })
    await esperar(7000)

    // ── El calendario ya no corta en hoy ──────────────────────────────────
    const tope = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'))
      const lbl = labels.find((l) => /hasta/i.test(l.textContent ?? ''))
      const inp = lbl?.parentElement?.querySelector('input[type="date"]') as HTMLInputElement | null
      return inp ? { max: inp.getAttribute('max'), valor: inp.value } : null
    })
    check('Está el campo "Hasta (despacho)"', !!tope)
    check('El calendario ya no tiene tope en hoy',
      !!tope && !tope.max, `max = ${tope?.max ?? 'ninguno'}`)

    // ── El botón nuevo ────────────────────────────────────────────────────
    const hayBoton = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).some((b) => /^mañana$/i.test((b.textContent ?? '').trim())))
    check('Está el botón "Mañana"', hayBoton)

    const filasDe = async () => page.evaluate(() =>
      document.querySelectorAll('table tbody tr').length)
    const resumen = async () => page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('div'))
        .find((d) => /comprobantes?$/.test((d.textContent ?? '').trim())
          && (d.textContent ?? '').includes('·') && d.children.length === 0)
      return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
    })

    const filasHoy = await filasDe()
    check('Hoy muestra sus movimientos', filasHoy > 0, `${filasHoy} productos · ${await resumen()}`)

    // Apretar "Mañana", como lo haría el almacenero.
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => /^mañana$/i.test((x.textContent ?? '').trim()))
      ;(b as HTMLButtonElement)?.click()
    })
    await esperar(7000)

    const fechas = await page.evaluate(() => {
      const ins = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[]
      return ins.map((i) => i.value)
    })
    check('Al apretar "Mañana" el rango salta al día siguiente',
      fechas.includes(mananaLima()), fechas.join(' → '))

    const filasManana = await filasDe()
    check('Muestra los movimientos de mañana', filasManana > 0,
      `${filasManana} productos · ${await resumen()}`)

    await page.screenshot({ path: '.sunat/movimientos-manana.png', fullPage: false })

    const graves = errores.filter((e) =>
      !e.includes('favicon') && !e.includes('manifest') && !e.includes('sw.js')
      && !e.toLowerCase().includes('download the react devtools'))
    check('Sin errores de JavaScript en pantalla', graves.length === 0,
      graves.slice(0, 2).join(' | ').slice(0, 130))
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
