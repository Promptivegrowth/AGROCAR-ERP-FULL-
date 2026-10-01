/**
 * Lo emitido para el reparto de mañana tiene que verse aunque sea del mes que
 * viene.
 *
 * Daniel: "no aparecen los comprobantes emitidos". El 30/09 a la noche se
 * emitieron 82 comprobantes con fecha 01/10 —la del reparto— y la pantalla
 * abría en septiembre sin ofrecer octubre en la lista de meses.
 *
 * Solo mira: no crea ni toca comprobantes.
 *
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-periodo-del-reparto.ts
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
const ADMIN = { correo: `zz.periodo.${sello}@agrocar.pe`, clave: `Zp-${sello}-t!` }
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log(`\nLO EMITIDO PARA EL REPARTO, EN SU MES — ${BASE}\n`)

  // La verdad, contada por la base: el mes mas nuevo y cuantos tiene.
  const { data: ultimo } = await (admin as any).from('comprobantes')
    .select('fecha_emision').order('fecha_emision', { ascending: false }).limit(1).maybeSingle()
  if (!ultimo) throw new Error('No hay comprobantes para probar')
  const mes = String(ultimo.fecha_emision).slice(0, 7)
  const [a, m] = mes.split('-').map(Number)
  const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
  const { count } = await (admin as any).from('comprobantes')
    .select('id', { count: 'exact', head: true })
    .gte('fecha_emision', `${mes}-01`).lte('fecha_emision', fin)
  console.log(`  la base dice: ${count} comprobantes en ${mes}\n`)

  const { data: creado, error } = await admin.auth.admin.createUser({
    email: ADMIN.correo, password: ADMIN.clave, email_confirm: true,
  })
  if (error) throw error
  const userId = creado.user!.id
  await admin.from('profiles').upsert({
    id: userId, email: ADMIN.correo, full_name: 'ZZ Periodo de prueba',
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
    await page.setBypassServiceWorker(true)

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 120000 })
    for (let i = 0; i < 5; i++) {
      await esperar(3000)
      await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.type('input[type="email"]', ADMIN.correo)
      await page.type('input[type="password"]', ADMIN.clave)
      await esperar(800)
      const ok = await page.evaluate((c) =>
        (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === c,
      ADMIN.correo)
      if (ok) break
    }
    await page.keyboard.press('Enter')
    for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)
    check('Entra al sistema', !page.url().includes('/login'))

    await page.goto(`${BASE}/facturacion`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(6000)
    // La pantalla abre en "Pedidos Pendientes": lo emitido está en la otra pestaña.
    // Las pestañas responden al mouse de verdad, no a un .click() de JS.
    const tab = await page.$('xpath/.//*[@role="tab"][contains(., "Comprobantes Emitidos")]')
    if (!tab) throw new Error('No aparece la pestaña de comprobantes emitidos')
    await tab.click()
    await esperar(6000)

    const estado = await page.evaluate(() => {
      const franja = document.querySelector('[data-franja="periodo"]') as HTMLElement | null
      const selector = Array.from(document.querySelectorAll('select'))
        .find((s) => Array.from(s.options).some((o) => /^\d{4}-\d{2}$/.test(o.value))) as HTMLSelectElement | undefined
      return {
        franja: franja?.innerText ?? '',
        elegido: selector?.value ?? '',
        opciones: selector ? Array.from(selector.options).map((o) => o.value) : [],
      }
    })
    check('Abre en el mes de lo emitido', estado.elegido === mes, `elegido ${estado.elegido}`)
    check('Ese mes está en la lista', estado.opciones.includes(mes), estado.opciones.join(', '))
    const n = Number((estado.franja.match(/(\d+) comprobantes?/) ?? [])[1] ?? -1)
    check('Muestra todos los del mes', n === count, `pantalla ${n}, base ${count}`)

    await page.screenshot({ path: '.sunat/periodo-del-reparto.png', fullPage: false })
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

main().catch((e) => { console.error('\nFALLÓ:', e.stack, '\n'); process.exit(1) })
