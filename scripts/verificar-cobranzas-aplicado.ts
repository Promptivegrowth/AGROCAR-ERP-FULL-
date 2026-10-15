/**
 * Cobranzas: saldos con todos los comprobantes (paginado) y antigüedad según lo
 * aplicado de verdad; un comprobante cobrado dice "Pagado" (15/10). Solo mira.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-cobranzas-aplicado.ts
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
  const cred = { correo: `zz.cbza.${sello}@agrocar.pe`, clave: `Zc-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Cobranzas', role: 'administrador', activo: true })
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
    await page.goto(`${BASE}/cobranzas`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(9000)
    let txt = await page.evaluate(() => document.body.innerText)
    check('Cobranzas carga y lista a FLORES JAHUIRA AGAPITO', txt.includes('FLORES JAHUIRA AGAPITO'))
    const busca = await page.$('input[placeholder^="Buscar por razón social"]')
    await busca!.type('FLORES JAHUIRA'); await esperar(1500)
    await page.evaluate(`(() => { const tr = Array.from(document.querySelectorAll('tr')).find((x) => x.textContent && x.textContent.includes('FLORES JAHUIRA AGAPITO')); const bs = tr ? Array.from(tr.querySelectorAll('button')).filter((b) => !(b.textContent || '').includes('Pago')) : []; if (bs[0]) bs[0].click() })()`)
    await esperar(3000)
    txt = await page.evaluate(() => document.body.innerText)
    check('En el detalle, la F002-00000030 (ya cobrada) dice "Pagado"', /F002-00000030[\s\S]{0,120}Pagado/.test(txt))
    check('La F002-00000077 (impaga) sigue "Vencido"', /F002-00000077[\s\S]{0,120}Vencido/.test(txt))
    await page.screenshot({ path: '.sunat/cobranzas-aplicado.png' })
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
