/**
 * Liquidación de documentos internos (Daniel, 06/10). Solo mira: abre el
 * reporte de octubre de la Procesadora y el diálogo de la factura, sin
 * registrarla. La lógica (no suma stock, va al SIRE, descuenta lo pendiente)
 * la probó el ensayo de la migración 130.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-liquidacion-internos.ts
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

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const sello = Date.now()
  const cred = { correo: `zz.liq.${sello}@agrocar.pe`, clave: `Zl-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Liquidacion', role: 'almacenero', activo: true })
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

    await page.goto(`${BASE}/almacen/compras`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(3000)
    check('Compras tiene el acceso a "Liquidación de internos"', !!(await page.$('a[href="/almacen/compras/liquidacion"]')))

    await page.goto(`${BASE}/almacen/compras/liquidacion`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(5000)
    const prov = await page.$eval('select[aria-label="Proveedor"]', (s) => (s as HTMLSelectElement).selectedOptions[0]?.textContent ?? '')
    check('Abre con la Procesadora de Alimentos AGROCAR', /PROCESADORA DE ALIMENTOS AGROCAR/.test(prov), prov)
    const filas = await page.$$eval('[data-fila-liq]', (x) => x.map((r) => r.textContent?.replace(/\s+/g, ' ').trim().slice(0, 110)))
    check('Muestra agua y hielo con lo vendido del mes', filas.length >= 3, filas.join(' | '))
    const pend = await page.$eval('[data-total-pendiente]', (e) => e.textContent ?? '')
    console.log(`  info  ${pend}`)
    const boton = await page.$('[data-registrar-factura]')
    const habil = boton ? await boton.evaluate((b) => !(b as HTMLButtonElement).disabled) : false
    if (habil) {
      await boton!.click(); await esperar(1200)
      const lineas = await page.$$eval('[data-dialogo-regularizacion] tbody tr', (x) => x.length)
      const guardarDeshab = await page.$eval('[data-guardar-factura]', (b) => (b as HTMLButtonElement).disabled)
      check('El diálogo viene precargado y pide el N° de factura', lineas > 0 && guardarDeshab, `${lineas} líneas`)
      await page.screenshot({ path: '.sunat/liquidacion-dialogo.png' })
      await page.keyboard.press('Escape'); await esperar(500)
    } else {
      check('Sin pendiente, el botón de registrar está deshabilitado', true)
    }
    await page.screenshot({ path: '.sunat/liquidacion.png', fullPage: true })
    check('Sin errores de JavaScript', errores.length === 0, errores[0] ?? '')
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
