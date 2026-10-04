/**
 * Reporte gerencial de utilidad: abre, cambia el rango, baja el Excel, se ve
 * en celular y el contador no entra. Daniel, 04/10. Solo mira.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-utilidad.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { calcularUtilidad } from '../src/lib/reporte-utilidad'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3014'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
const res: boolean[] = []
const check = (q: string, ok: boolean, d = '') => {
  res.push(ok)
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${q}${d ? `  — ${d}` : ''}`)
}
const soles = (t: string) => Number(t.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3})/g, ''))

async function entrar(page: Page, correo: string, clave: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 180000 })
  for (let i = 0; i < 5; i++) {
    await esperar(3000)
    await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
    await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
    await page.type('input[type="email"]', correo)
    await page.type('input[type="password"]', clave)
    await esperar(800)
    if (await page.evaluate((c) => (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === c, correo)) break
  }
  await page.keyboard.press('Enter')
  for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const base = await calcularUtilidad(admin, '2026-10-02', '2026-10-03')
  console.log(`\nBase 02–03/10: venta ${base.total.venta} · utilidad ${base.total.utilidad}\n`)

  const sello = Date.now()
  const usuarios: string[] = []
  const crear = async (rol: string) => {
    const cred = { correo: `zz.ut.${rol}.${sello}@agrocar.pe`, clave: `Zu-${sello}-t!` }
    const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
    const uid = data!.user!.id
    usuarios.push(uid)
    await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: `ZZ Utilidad ${rol}`, role: rol, activo: true })
    return cred
  }
  const gerente = await crear('gerente')
  const contador = await crear('contador')

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 950 })
    await page.setBypassServiceWorker(true)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(String((e as Error).message).slice(0, 120)))
    await entrar(page, gerente.correo, gerente.clave)

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(2000)
    check('El menú del gerente muestra "Utilidad"', !!(await page.$('a[href="/gerencia/utilidad"]')))

    await page.goto(`${BASE}/gerencia/utilidad`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(3000)
    await page.screenshot({ path: '.sunat/utilidad-escritorio.png', fullPage: false })
    const fechas = await page.$$eval('input[type="date"]', (x) => x.map((e) => (e as HTMLInputElement).value))
    check('Abre con el mes en curso', fechas.length === 2 && fechas[0].endsWith('-01'), fechas.join(' → '))

    // Cambiar el rango con los campos, como lo haría Daniel.
    const poner = async (i: number, v: string) => {
      const el = (await page.$$('input[type="date"]'))[i]
      await el.evaluate((e: any, val: string) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        set.call(e, val)
        e.dispatchEvent(new Event('input', { bubbles: true }))
        e.dispatchEvent(new Event('change', { bubbles: true }))
      }, v)
      await esperar(6000)
    }
    await poner(0, '2026-10-02')
    await poner(1, '2026-10-03')
    // Como texto: tsx le agrega __name a las funciones internas y en el navegador no existe.
    const kpi = await page.evaluate(`(() => {
      const t = (k) => Array.from(document.querySelectorAll('p')).find((p) => p.textContent === k)?.nextElementSibling?.textContent ?? ''
      return { venta: t('VENTA NETA'), utilidad: t('UTILIDAD NETA'), url: location.search }
    })()`) as { venta: string; utilidad: string; url: string }
    check('El rango desde/hasta cambia el reporte y cuadra con la base',
      Math.abs(soles(kpi.venta) - base.total.venta) < 0.01 && Math.abs(soles(kpi.utilidad) - (base.total.utilidad)) < 0.01,
      `${kpi.url} · venta ${kpi.venta} · utilidad ${kpi.utilidad}`)
    await page.screenshot({ path: '.sunat/utilidad-rango.png', fullPage: true })

    // Filtro por familia: solo esa, y los totales son los de esa familia.
    const fam = base.grupos[1]
    await page.select('select[aria-label="Filtro"]', fam.grupo)
    await esperar(6000)
    const kf = await page.evaluate(`(() => {
      const t = (k) => Array.from(document.querySelectorAll('p')).find((p) => p.textContent === k)?.nextElementSibling?.textContent ?? ''
      return { venta: t('VENTA NETA'), url: location.search, grupos: document.querySelectorAll('tbody').length - 1 }
    })()`) as { venta: string; url: string; grupos: number }
    check('El filtro de marca muestra solo esa marca', Math.abs(soles(kf.venta) - fam.venta) < 0.01 && kf.grupos === 1,
      `${decodeURIComponent(kf.url)} · venta ${kf.venta} (base ${fam.venta})`)
    await page.select('select[aria-label="Filtro"]', '')
    await esperar(6000)

    // Por marca es lo que abre; por tipo de producto reagrupa y el total no cambia.
    const marcas = await page.$$eval('[data-fila-grupo]', (x) => x.length)
    check('Abre agrupado por marca, con su % de la utilidad', marcas === base.grupos.length
      && (await page.evaluate(() => document.body.innerText.includes('% de la utilidad'))), `${marcas} marcas`)
    await page.select('select[aria-label="Agrupar por"]', 'tipo')
    await esperar(6000)
    const tipo = await page.evaluate(`(() => {
      const t = (k) => Array.from(document.querySelectorAll('p')).find((p) => p.textContent === k)?.nextElementSibling?.textContent ?? ''
      return { venta: t('VENTA NETA'), filas: document.querySelectorAll('[data-fila-grupo]').length, h1: document.querySelector('h1')?.textContent ?? '' }
    })()`) as { venta: string; filas: number; h1: string }
    check('Agrupar por tipo de producto reagrupa sin cambiar el total',
      Math.abs(soles(tipo.venta) - base.total.venta) < 0.01 && tipo.filas > 0 && tipo.filas !== marcas,
      `${tipo.h1} · ${tipo.filas} tipos · venta ${tipo.venta}`)
    await page.screenshot({ path: '.sunat/utilidad-tipo.png', fullPage: false })
    await page.select('select[aria-label="Agrupar por"]', 'marca')
    await esperar(6000)
    await page.screenshot({ path: '.sunat/utilidad-marca.png', fullPage: false })

    const excel = await page.evaluate(async () => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => x.textContent?.includes('Excel')) as HTMLAnchorElement
      const r = await fetch(a.href)
      return { status: r.status, tipo: r.headers.get('content-type') ?? '', bytes: (await r.arrayBuffer()).byteLength }
    })
    check('El Excel se descarga', excel.status === 200 && excel.tipo.includes('spreadsheet') && excel.bytes > 5000,
      `${excel.status} · ${excel.bytes} bytes`)

    await page.emulateMediaType('print')
    await page.pdf({ path: '.sunat/utilidad.pdf', format: 'A4', landscape: true, printBackground: true })
    await page.emulateMediaType('screen')
    check('Se imprime en PDF', fs.statSync('.sunat/utilidad.pdf').size > 20000)

    await page.setViewport({ width: 390, height: 844 })
    await esperar(1500)
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth)
    await page.screenshot({ path: '.sunat/utilidad-celular.png', fullPage: false })
    console.log(`  info  ancho de página en celular: ${ancho}px`)
    check('Sin errores de JavaScript', errores.length === 0, errores[0] ?? '')

    // El contador no entra.
    const p2 = await (await browser.createBrowserContext()).newPage()
    await p2.setBypassServiceWorker(true)
    await entrar(p2, contador.correo, contador.clave)
    await p2.goto(`${BASE}/gerencia/utilidad`, { waitUntil: 'networkidle2', timeout: 180000 })
    check('El contador no puede abrir la pantalla', !p2.url().includes('/gerencia'), p2.url().replace(BASE, ''))
    const r2 = await p2.goto(`${BASE}/api/gerencia/utilidad/excel?desde=2026-10-01&hasta=2026-10-03`, { waitUntil: 'networkidle2' })
    check('El contador no puede bajar el Excel', !p2.url().includes('/api/gerencia') && !(r2?.headers()['content-type'] ?? '').includes('spreadsheet'),
      p2.url().replace(BASE, ''))
  } finally {
    if (browser) await browser.close()
    for (const uid of usuarios) {
      await admin.from('profiles').delete().eq('id', uid)
      await admin.auth.admin.deleteUser(uid)
    }
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
