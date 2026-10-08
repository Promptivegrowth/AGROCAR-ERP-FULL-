/**
 * Caja por día (Daniel, 07/10): la caja abierta de un día anterior muestra y
 * cuadra los cobros de ESE día, no los de hoy. Solo mira, no cierra nada.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-caja-por-dia.ts
 */
import fs from 'node:fs'
import path from 'node:path'
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
const S = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const { data: ses } = await admin.from('caja_sesiones').select('id, fecha_caja, saldo_inicial').eq('estado', 'abierta').maybeSingle()
  if (!ses) { console.log('No hay caja abierta: nada que mirar'); return }
  const { data: cob } = await admin.from('cobros').select('total').eq('fecha', ses.fecha_caja)
  const totDia = Math.round((cob ?? []).reduce((s: number, c: any) => s + Number(c.total), 0) * 100) / 100
  const [a, m, d] = ses.fecha_caja.split('-')
  console.log(`\nCaja abierta del ${d}/${m}/${a}: ${(cob ?? []).length} cobros por S/ ${S(totDia)}\n`)

  const sello = Date.now()
  const cred = { correo: `zz.cdia.${sello}@agrocar.pe`, clave: `Zc-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Caja por día', role: 'administrador', activo: true })
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
    await esperar(6000)
    const txt = await page.evaluate(() => document.body.innerText)
    check('El encabezado muestra el día de la caja', txt.includes(`Centro financiero — ${d}/${m}/${a}`))
    check('Avisa que es la caja de un día anterior', txt.includes('Caja de un día anterior'))
    check('Lista los cobros de ese día', txt.includes(`Cobros del Día (${(cob ?? []).length})`))
    check('El total del día aparece en pantalla', txt.includes(S(totDia)), `S/ ${S(totDia)}`)
    await page.screenshot({ path: '.sunat/caja-por-dia.png', fullPage: true })
    check('Sin errores de JavaScript (salvo el aviso de hidratación ya conocido de Caja)',
      errores.filter((e) => !/server-rendered HTML|hydrat/i.test(e)).length === 0, errores.join(' // '))
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
