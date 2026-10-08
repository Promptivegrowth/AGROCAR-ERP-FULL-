/**
 * Caja por día (Daniel, 07 y 08/10): se elige el día arriba; cada día muestra
 * y liquida sus propios cobros, y cada uno tiene su caja. Solo mira: no abre ni
 * cierra ninguna caja.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-caja-por-dia.ts
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
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
  const delDia = async (f: string) => {
    const { data } = await admin.from('cobros').select('total').eq('fecha', f)
    return { n: (data ?? []).length, t: Math.round((data ?? []).reduce((s: number, c: any) => s + Number(c.total), 0) * 100) / 100 }
  }
  const { data: abiertas } = await admin.from('caja_sesiones').select('fecha_caja').eq('estado', 'abierta')
  const otraAbierta: string | undefined = (abiertas ?? []).map((s: any) => s.fecha_caja).find((f: string) => f !== hoy)
  const deHoy = await delDia(hoy)
  console.log(`\nHoy ${dm(hoy)}: ${deHoy.n} cobros por S/ ${S(deHoy.t)} · cajas abiertas: ${(abiertas ?? []).map((s: any) => dm(s.fecha_caja)).join(', ') || 'ninguna'}\n`)

  const sello = Date.now()
  const cred = { correo: `zz.cdia.${sello}@agrocar.pe`, clave: `Zc-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Caja por día', role: 'administrador', activo: true })
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
    await page.goto(`${BASE}/caja`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(6000)

    // 1) Por defecto, hoy: sus cobros y su liquidación, aunque otra caja esté abierta.
    let txt = await page.evaluate(() => document.body.innerText)
    const diaSel = await page.$eval('[data-dia-caja]', (e) => (e as HTMLInputElement).value)
    check('Abre en el día de hoy', diaSel === hoy, diaSel)
    check('Lista los cobros de hoy', txt.includes(`Cobros del Día (${deHoy.n})`), `${deHoy.n} cobros`)
    if (otraAbierta) check(`Ofrece ir a la caja abierta del ${dm(otraAbierta)}`, !!(await page.$(`[data-caja-abierta="${otraAbierta}"]`)))
    const abierta = (abiertas ?? []).some((s: any) => s.fecha_caja === hoy)
    if (!abierta) check('Sin caja de hoy, ofrece abrirla', !!(await page.$('[data-abrir-caja]')))
    const liq = await page.$('xpath/.//button[@role="tab"][contains(., "Liquidación")]')
    await liq!.click(); await esperar(2000)
    const rend = await page.$$eval('a[href^="/rendicion/"]', (as) => as.map((a) => a.getAttribute('href') ?? ''))
    check('La liquidación de hoy tiene sus rendiciones para imprimir', rend.length > 0 && rend.every((h) => h.endsWith(`fecha=${hoy}`)), `${rend.length} rendiciones`)
    await page.screenshot({ path: '.sunat/caja-hoy.png', fullPage: false })

    // 2) La caja abierta de otro día: sus propios cobros.
    if (otraAbierta) {
      const otra = await delDia(otraAbierta)
      await page.click(`[data-caja-abierta="${otraAbierta}"]`); await esperar(5000)
      txt = await page.evaluate(() => document.body.innerText)
      check(`La caja del ${dm(otraAbierta)} muestra sus cobros y su total`,
        txt.includes(`Cobros del ${dm(otraAbierta)}`) && txt.includes(S(otra.t)) && !txt.includes('No hay caja abierta'), `${otra.n} cobros · S/ ${S(otra.t)}`)
      check('La dirección guarda el día elegido', page.url().includes(`dia=${otraAbierta}`), page.url())
      await page.screenshot({ path: '.sunat/caja-otro-dia.png', fullPage: false })
      await page.click('[data-ir-hoy]'); await esperar(5000)
      const vuelta = await page.$eval('[data-dia-caja]', (e) => (e as HTMLInputElement).value)
      txt = await page.evaluate(() => document.body.innerText)
      check('"Ir a hoy" vuelve al día de hoy', vuelta === hoy && txt.includes('No hay caja abierta de hoy'), vuelta)
    }
    check('Sin errores de JavaScript (salvo el aviso de hidratación ya conocido de Caja)',
      errores.filter((e) => !/server-rendered HTML|hydrat/i.test(e)).length === 0, errores.filter((e) => !/server-rendered HTML|hydrat/i.test(e)).join(' // '))
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
