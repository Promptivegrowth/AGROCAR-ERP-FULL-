/**
 * Compras con documento interno (Daniel, 05/10). Solo mira: recorre el
 * formulario sin guardar. La numeración, el IGV y la exclusión del SIRE se
 * probaron en la base (ensayo de la migración 127).
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-documento-interno.ts
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const sello = Date.now()
  const cred = { correo: `zz.di.${sello}@agrocar.pe`, clave: `Zd-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Doc interno', role: 'almacenero', activo: true })
  let browser: Browser | null = null
  try {
    const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!) as any
    await c.auth.signInWithPassword({ email: cred.correo, password: cred.clave })
    const r = await c.from('compras').select('id, documento_interno').limit(1)
    check('La API reconoce la columna documento_interno', !r.error, r.error?.message)

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
    const nueva = await page.$('xpath/.//button[contains(., "Nueva Compra")]')
    await nueva!.click(); await esperar(1500)
    check('El formulario ofrece "Documento interno"', !!(await page.$('[data-tipo="interno"]')))
    await page.click('[data-tipo="interno"]'); await esperar(800)
    const estado = await page.evaluate(() => ({
      numero: (document.querySelector('[data-numero-interno]') as HTMLInputElement)?.value ?? '',
      aviso: !!document.querySelector('[data-aviso-interno]'),
      proveedor: (Array.from(document.querySelectorAll('input')).find((i) => (i as HTMLInputElement).placeholder?.startsWith('Buscar por raz')) as HTMLInputElement)?.value ?? '',
    }))
    check('El número se asigna solo', /DI/.test(estado.numero), estado.numero)
    check('Avisa que va sin IGV y fuera del Registro de Compras', estado.aviso)
    check('Propone el proveedor genérico', estado.proveedor === 'VARIOS - SIN COMPROBANTE', estado.proveedor)
    await page.screenshot({ path: '.sunat/doc-interno.png' })
    await page.click('[data-tipo="factura"]'); await esperar(600)
    const vuelve = await page.evaluate(() => !document.querySelector('[data-aviso-interno]') && !document.querySelector('[data-numero-interno]'))
    check('Al volver a "Factura" se pide el número y vuelve el IGV', vuelve)
    check('Sin errores de JavaScript', errores.length === 0, errores[0] ?? '')
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
