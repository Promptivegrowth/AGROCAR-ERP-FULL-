/**
 * App de cobros: lo vendido al contado va primero y cada documento dice si es
 * contado o crédito (Daniel, 14/10). Solo mira: no registra ningún cobro.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-cobro-contado-primero.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3014'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
const res: boolean[] = []
const check = (q: string, ok: boolean, d = '') => { res.push(ok); console.log(`  ${ok ? 'OK  ' : 'MAL '} ${q}${d ? `  — ${d}` : ''}`) }
const S = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const sello = Date.now()
  const cred = { correo: `zz.cont.${sello}@agrocar.pe`, clave: `Zc-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Cobro contado', role: 'repartidor', activo: true })
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page: Page = await browser.newPage()
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
    await page.setViewport({ width: 420, height: 900 })
    await page.goto(`${BASE}/pwa/cobros`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(6000)
    const buscar = await page.$('input[placeholder^="Buscar por nombre"]')
    check('La app de cobros abre con el buscador de clientes', !!buscar)
    await buscar!.type('FLORES JAHUIRA'); await esperar(2500)
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent?.includes('FLORES JAHUIRA AGAPITO')); (b as HTMLElement | undefined)?.click() })
    await esperar(5000)
    const lista = await page.$$eval('[data-condicion]', (els) => els.map((e) => ({ c: e.getAttribute('data-condicion'), doc: e.parentElement?.textContent?.match(/[FB]\d{3}-\d{8}/)?.[0] ?? '' })))
    console.log('   orden:', lista.map((x) => `${x.doc} (${x.c})`).join(' · '))
    const primerCredito = lista.findIndex((x) => x.c === 'credito')
    const ultimoContado = lista.map((x) => x.c).lastIndexOf('contado')
    check('Cada documento dice Contado o Crédito', lista.length > 0 && lista.every((x) => x.c === 'contado' || x.c === 'credito'), `${lista.length} documentos`)
    check('Lo vendido al contado aparece primero', lista.some((x) => x.c === 'contado') && (primerCredito === -1 || ultimoContado < primerCredito))
    const txt = await page.evaluate(() => document.body.innerText)
    check('El modo Automático explica el nuevo orden', txt.includes('primero a lo vendido al contado'))
    await page.screenshot({ path: '.sunat/cobro-contado-primero.png', fullPage: false })
    check('Sin errores de JavaScript', errores.filter((e) => !/hydrat|server-rendered/i.test(e)).length === 0, errores.join(' // '))
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  console.log(`
  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.
`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
