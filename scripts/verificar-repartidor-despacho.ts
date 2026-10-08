/**
 * Asignar repartidor a un despacho ya consolidado (Daniel, 07/10). Solo mira:
 * abre el Historial como administrador y el selector, sin guardar.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-repartidor-despacho.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3014'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
const res: boolean[] = []
const check = (q: string, ok: boolean, d = '') => { res.push(ok); console.log(`  ${ok ? 'OK  ' : 'MAL '} ${q}${d ? `  — ${d}` : ''}`) }

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const sello = Date.now()
  const cred = { correo: `zz.rd.${sello}@agrocar.pe`, clave: `Zr-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Repartidor despacho', role: 'administrador', activo: true })
  let browser: Browser | null = null
  try {
    const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!) as any
    await c.auth.signInWithPassword({ email: cred.correo, password: cred.clave })
    const { data: lista } = await c.rpc('repartidores_activos')
    check('La lista de repartidores se carga', (lista ?? []).length > 0, (lista ?? []).map((r: any) => r.nombre).join(', '))
    const r1 = await c.rpc('asignar_repartidor_despacho', { p_despacho_id: randomUUID(), p_repartidor_id: randomUUID() })
    check('La RPC responde (parámetros bien)', /no existe/i.test(r1.error?.message ?? ''), r1.error?.message)

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
    await page.goto(`${BASE}/despacho/historial`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(4000)
    const textos = await page.$$eval('[data-repartidor-despacho]', (x) => x.map((e) => e.textContent?.trim()))
    check('Cada carro listo o en ruta muestra quién reparte', textos.length > 0, textos.join(' | '))
    const sin = await page.$('xpath/.//p[@data-repartidor-despacho][contains(., "Sin repartidor")]//button')
    check('El carro sin repartidor ofrece "Asignar"', !!sin)
    if (sin) {
      await sin.click(); await esperar(800)
      const ops = await page.$$eval('select[aria-label="Repartidor"] option', (o) => o.map((x) => x.textContent))
      check('Se abre la lista de repartidores', ops.length > 1, ops.slice(1).join(', '))
      await page.screenshot({ path: '.sunat/repartidor-despacho.png' })
    }
    check('Sin errores de JavaScript', errores.length === 0, errores[0] ?? '')
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
