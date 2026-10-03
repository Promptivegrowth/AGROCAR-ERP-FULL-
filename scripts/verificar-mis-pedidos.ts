/**
 * "Mis pedidos" del aplicativo muestra el cliente y los productos (solo
 * lectura). Daniel, 03/10. Solo mira.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-mis-pedidos.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3014'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
const res: boolean[] = []
const check = (q: string, ok: boolean, d = '') => { res.push(ok); console.log(`  ${ok ? 'OK  ' : 'MAL '} ${q}${d ? `  — ${d}` : ''}`) }
async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const sello = Date.now(); const cred = { correo: `zz.mp.${sello}@agrocar.pe`, clave: `Zm-${sello}-t!` }
  const { data: cr } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = cr!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Mis pedidos', role: 'administrador', activo: true } as never)
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage(); await page.setViewport({ width: 400, height: 850, isMobile: true }); await page.setBypassServiceWorker(true)
    const errores: string[] = []; page.on('pageerror', (e) => errores.push(String((e as Error).message).slice(0, 100)))
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 180000 })
    for (let i = 0; i < 5; i++) {
      await esperar(3000)
      await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.type('input[type="email"]', cred.correo); await page.type('input[type="password"]', cred.clave)
      await esperar(800)
      if (await page.evaluate((c) => (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === c, cred.correo)) break
    }
    await page.keyboard.press('Enter')
    for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)
    await page.goto(`${BASE}/pwa/pedidos`, { waitUntil: 'networkidle2', timeout: 180000 }); await esperar(4000)
    const tab = await page.$('xpath/.//button[contains(., "Mis Pedidos")]'); if (tab) await tab.click()
    await esperar(5000)
    const clientes = await page.$$eval('[data-cliente-pedido]', (x) => x.map((e) => (e as HTMLElement).innerText))
    check('Muestra el nombre del cliente', clientes.length > 0 && clientes.every((c) => c && c !== 'Cliente'), `${clientes.length} pedidos · ${clientes.slice(0, 3).join(' | ')}`)
    const sum = await page.$('[data-productos-pedido] summary')
    if (sum) { await sum.click(); await esperar(600) }
    const prods = await page.$eval('[data-productos-pedido]', (e) => (e as HTMLElement).innerText).catch(() => '')
    check('Muestra los productos al tocar', /Ver productos/.test(prods) && prods.split('\n').length > 1, prods.replace(/\s+/g, ' ').slice(0, 120))
    const editables = await page.$$eval('[data-productos-pedido] input, [data-productos-pedido] button', (x) => x.length).catch(() => 0)
    check('Solo lectura (nada editable)', editables === 0)
    await page.screenshot({ path: '.sunat/mis-pedidos.png' })
    check('Sin errores de JavaScript', errores.length === 0, errores[0] ?? '')
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}
main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
