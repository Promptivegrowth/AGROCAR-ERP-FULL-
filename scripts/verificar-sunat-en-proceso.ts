/**
 * Estado SUNAT: lo que SUNAT dejó "en proceso" (0140) no se ve como rechazado
 * (11/10/2026). Solo mira.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-sunat-en-proceso.ts
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
  const cred = { correo: `zz.senp.${sello}@agrocar.pe`, clave: `Zc-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ SUNAT en proceso', role: 'administrador', activo: true })
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
    await page.goto(`${BASE}/facturacion/sunat`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(9000)
    const r = await page.evaluate(() => ({
      enProceso: document.querySelectorAll('[data-estado="en_proceso"]').length,
      rechazados: document.querySelectorAll('[data-estado="rechazado"]').length,
      etiqueta: document.querySelector('[data-estado="en_proceso"]')?.textContent ?? '',
    }))
    console.log('  ', JSON.stringify(r))
    check('Los comprobantes con 0140 se ven "En proceso en SUNAT"', r.enProceso > 0 && r.etiqueta.includes('En proceso'), `${r.enProceso} en proceso`)
    check('Ninguno aparece como Rechazado', r.rechazados === 0, `${r.rechazados} rechazados`)
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
