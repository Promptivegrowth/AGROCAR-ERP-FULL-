/**
 * Caja → "Acumulado por fechas" (Daniel, 05/10). Solo mira.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-caja-acumulado.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'
import { traerTodo } from '../src/lib/supabase/paginar'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3014'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
const res: boolean[] = []
const check = (q: string, ok: boolean, d = '') => { res.push(ok); console.log(`  ${ok ? 'OK  ' : 'MAL '} ${q}${d ? `  — ${d}` : ''}`) }
const soles = (t: string) => Number(t.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3})/g, ''))
const DESDE = '2026-10-01', HASTA = '2026-10-05'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const cobros = await traerTodo<any>((a, b) => admin.from('cobros').select('efectivo, yape, plin, transferencia, total')
    .gte('fecha', DESDE).lte('fecha', HASTA).order('id').range(a, b))
  const base = ['efectivo', 'yape', 'plin', 'transferencia', 'total'].reduce((acc: any, k) => {
    acc[k] = Math.round(cobros.reduce((s, c) => s + Number(c[k] ?? 0), 0) * 100) / 100; return acc
  }, {})
  console.log(`\nBase ${DESDE} a ${HASTA}: ${cobros.length} cobros`, base, '\n')

  const sello = Date.now()
  const cred = { correo: `zz.acu.${sello}@agrocar.pe`, clave: `Za-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Acumulado caja', role: 'caja', activo: true })
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 950 })
    await page.setBypassServiceWorker(true)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(String((e as Error).message).slice(0, 120)))
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 180000 })
    for (let i = 0; i < 5; i++) {
      await esperar(3000)
      await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.type('input[type="email"]', cred.correo); await page.type('input[type="password"]', cred.clave)
      await esperar(800)
      if (await page.evaluate((x) => (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === x, cred.correo)) break
    }
    await page.keyboard.press('Enter')
    for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)
    await page.goto(`${BASE}/caja`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(4000)
    const tab = await page.$('[data-tab-acumulado]')
    check('Caja tiene la pestaña "Acumulado por fechas"', !!tab)
    await tab!.click(); await esperar(3500)
    const poner = async (sel: string, v: string) => {
      await page.$eval(sel, (e: any, val: string) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        set.call(e, val); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }))
      }, v)
      await esperar(2500)
    }
    await poner('[data-desde]', DESDE)
    await poner('[data-hasta]', HASTA)
    const pant = await page.$$eval('[data-medio]', (els) => els.map((e) => [e.getAttribute('data-medio'), e.querySelectorAll('p')[1]?.textContent ?? '']))
    const mapa = Object.fromEntries(pant) as Record<string, string>
    const ok = ['efectivo', 'yape', 'plin', 'transferencia', 'total'].every((k) => Math.abs(soles(mapa[k] ?? 'x') - base[k]) < 0.01)
    check('Efectivo, Yape, Plin, transferencia y total cuadran con la base', ok,
      `ef ${mapa.efectivo} · yape ${mapa.yape} · plin ${mapa.plin} · transf ${mapa.transferencia} · total ${mapa.total}`)
    const dias = await page.$$eval('[data-fila-dia]', (x) => x.length)
    check('Muestra el detalle por día', dias > 0, `${dias} días`)
    await page.screenshot({ path: '.sunat/caja-acumulado.png', fullPage: true })
    const mesAnt = await page.$('xpath/.//button[contains(., "Mes anterior")]')
    await mesAnt!.click(); await esperar(3000)
    const desdeMes = await page.$eval('[data-desde]', (e) => (e as HTMLInputElement).value)
    check('El atajo "Mes anterior" cambia el rango', /-09-01$/.test(desdeMes), desdeMes)
    check('Sin errores de JavaScript (salvo el aviso de hidratación ya conocido de Caja)',
      errores.filter((e) => !/server-rendered HTML|Hydration/i.test(e)).length === 0, errores.filter((e) => !/server-rendered HTML|Hydration/i.test(e)).join(' // ') || errores.join(' // '))
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
