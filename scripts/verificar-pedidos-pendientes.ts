/**
 * Pedidos abre en "Pendientes" y las ventas directas tienen su pestaña.
 * Daniel: "las ventas directas salen en pedidos… no debería, ya no está pendiente".
 * Solo mira.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-pedidos-pendientes.ts
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
  const { count: pend } = await (admin as any).from('pedidos').select('id', { count: 'exact', head: true }).in('estado', ['enviado', 'validado'])
  const { count: ent } = await (admin as any).from('pedidos').select('id', { count: 'exact', head: true }).eq('estado', 'entregado')
  console.log(`\nPEDIDOS — ${BASE} (base: ${pend} pendientes, ${ent} entregados)\n`)
  const sello = Date.now(); const cred = { correo: `zz.ped.${sello}@agrocar.pe`, clave: `Zp-${sello}-t!` }
  const { data: cr } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = cr!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Pedidos', role: 'administrador', activo: true } as never)
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 1000 }); await page.setBypassServiceWorker(true)
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
    await page.goto(`${BASE}/pedidos`, { waitUntil: 'networkidle2', timeout: 180000 }); await esperar(6000)
    const v = await page.evaluate(() => ({
      activa: (document.querySelector('[role="tab"][data-state="active"]') as HTMLElement | null)?.innerText ?? '',
      texto: document.body.innerText,
    }))
    check('Abre en "Pendientes"', /Pendientes/.test(v.activa), v.activa.replace(/\s+/g, ' '))
    check('Sin ventas directas (Entregado) a la vista', !/\bEntregado\b/.test(v.texto.split('ESTADO').slice(1).join(' ')))
    const tab = await page.$('xpath/.//*[@role="tab"][contains(., "Ventas directas")]')
    check('Existe la pestaña "Ventas directas / entregados"', !!tab)
    if (tab) {
      await tab.click(); await esperar(1500)
      const n = await page.evaluate(() => (document.body.innerText.match(/\bEntregado\b/g) ?? []).length)
      check('Ahí están las ventas directas', n >= Number(0) && n > 0, `${n} filas Entregado`)
    }
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}
main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
