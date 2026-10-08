/**
 * Registros de ventas y compras (gerencia, Daniel 07/10). Solo mira.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-registros.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { traerTodo } from '../src/lib/supabase/paginar'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3014'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
const res: boolean[] = []
const check = (q: string, ok: boolean, d = '') => { res.push(ok); console.log(`  ${ok ? 'OK  ' : 'MAL '} ${q}${d ? `  — ${d}` : ''}`) }
const soles = (t: string) => Number(t.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3})/g, ''))
const DESDE = '2026-10-01', HASTA = '2026-10-07'

async function entrar(page: Page, correo: string, clave: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 180000 })
  for (let i = 0; i < 5; i++) {
    await esperar(3000)
    await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
    await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
    await page.type('input[type="email"]', correo); await page.type('input[type="password"]', clave)
    await esperar(800)
    if (await page.evaluate((x) => (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === x, correo)) break
  }
  await page.keyboard.press('Enter')
  for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)
}
async function poner(page: Page, sel: string, v: string) {
  await page.$eval(sel, (e: any, val: string) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(e, val); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }))
  }, v)
  await esperar(2500)
}
const kpi = (page: Page, k: string) => page.$eval(`[data-kpi="${k}"]`, (e) => e.querySelectorAll('p')[1]?.textContent ?? '')

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const ventas = await traerTodo<any>((a, b) => admin.from('comprobantes').select('tipo, total, estado')
    .gte('fecha_emision', DESDE).lte('fecha_emision', HASTA).neq('estado', 'anulado').order('id').range(a, b))
  const suma = (t: string) => Math.round(ventas.filter((v) => v.tipo === t).reduce((s, v) => s + Number(v.total), 0) * 100) / 100
  const baseV = { factura: suma('factura'), boleta: suma('boleta'), interno: suma('nota_pedido_interna'), nc: suma('nota_credito') }
  const totalV = Math.round((baseV.factura + baseV.boleta + baseV.interno - baseV.nc) * 100) / 100
  const { data: compras } = await admin.from('compras').select('total, estado').gte('fecha', DESDE).lte('fecha', HASTA).neq('estado', 'anulada')
  const totalC = Math.round((compras ?? []).reduce((s: number, c: any) => s + Number(c.total), 0) * 100) / 100
  console.log(`\nBase ${DESDE} a ${HASTA}: ventas ${totalV} (F ${baseV.factura} · B ${baseV.boleta} · DI ${baseV.interno}) · compras ${totalC}\n`)

  const sello = Date.now()
  const usuarios: string[] = []
  const crear = async (rol: string) => {
    const cred = { correo: `zz.reg.${rol}.${sello}@agrocar.pe`, clave: `Zg-${sello}-t!` }
    const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
    usuarios.push(data!.user!.id)
    await admin.from('profiles').upsert({ id: data!.user!.id, email: cred.correo, full_name: `ZZ Registros ${rol}`, role: rol, activo: true })
    return cred
  }
  const ger = await crear('gerente')
  const cont = await crear('contador')
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 950 })
    await page.setBypassServiceWorker(true)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(String((e as Error).message).slice(0, 120)))
    await entrar(page, ger.correo, ger.clave)

    await page.goto(`${BASE}/gerencia/registro-ventas`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(3000)
    await poner(page, '[data-desde]', DESDE); await poner(page, '[data-hasta]', HASTA)
    const t = await kpi(page, 'total'), f = await kpi(page, 'factura'), b = await kpi(page, 'boleta'), d = await kpi(page, 'nota_pedido_interna')
    check('Ventas: total, facturas, boletas y doc. internos cuadran con la base',
      Math.abs(soles(t) - totalV) < 0.01 && Math.abs(soles(f) - baseV.factura) < 0.01 && Math.abs(soles(b) - baseV.boleta) < 0.01 && Math.abs(soles(d) - baseV.interno) < 0.01,
      `total ${t} · F ${f} · B ${b} · DI ${d}`)
    await page.select('select[aria-label="Tipo"]', 'factura'); await esperar(800)
    const soloF = await kpi(page, 'total')
    const filasF = await page.$$eval('[data-fila-venta]', (x) => x.length)
    check('Filtro "Factura" deja solo facturas', Math.abs(soles(soloF) - baseV.factura) < 0.01 && filasF === ventas.filter((v) => v.tipo === 'factura').length, `${soloF} · ${filasF} filas`)
    await page.select('select[aria-label="Tipo"]', 'todos'); await esperar(800)
    for (const v of ['dia', 'vendedor', 'cliente']) {
      await page.click(`[data-vista="${v}"]`); await esperar(500)
      check(`Vista "${v}" se muestra`, !!(await page.$(`[data-tabla="${v}"]`)))
    }
    await page.screenshot({ path: '.sunat/registro-ventas.png', fullPage: false })
    const xv = await page.evaluate(async () => {
      const a = document.querySelector('[data-excel]') as HTMLAnchorElement
      const r = await fetch(a.href); return { s: r.status, t: r.headers.get('content-type') ?? '', n: (await r.arrayBuffer()).byteLength }
    })
    check('Excel de ventas', xv.s === 200 && xv.t.includes('spreadsheet') && xv.n > 5000, `${xv.n} bytes`)

    await page.goto(`${BASE}/gerencia/registro-compras`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(3000)
    await poner(page, '[data-desde]', DESDE); await poner(page, '[data-hasta]', HASTA)
    const tc = await kpi(page, 'total')
    check('Compras: el total cuadra con la base', Math.abs(soles(tc) - totalC) < 0.01, `${tc} (base ${totalC})`)
    await page.click('[data-vista="proveedor"]'); await esperar(500)
    check('Compras por proveedor se muestra', !!(await page.$('[data-tabla="proveedor"]')))
    await page.screenshot({ path: '.sunat/registro-compras.png', fullPage: false })
    const xc = await page.evaluate(async () => {
      const a = document.querySelector('[data-excel]') as HTMLAnchorElement
      const r = await fetch(a.href); return { s: r.status, t: r.headers.get('content-type') ?? '', n: (await r.arrayBuffer()).byteLength }
    })
    check('Excel de compras', xc.s === 200 && xc.t.includes('spreadsheet'), `${xc.n} bytes`)
    check('El menú tiene el grupo Gerencia', !!(await page.$('a[href="/gerencia/registro-ventas"]')))
    check('Sin errores de JavaScript', errores.length === 0, errores[0] ?? '')

    const p2 = await (await browser.createBrowserContext()).newPage()
    await p2.setBypassServiceWorker(true)
    await entrar(p2, cont.correo, cont.clave)
    await p2.goto(`${BASE}/gerencia/registro-ventas`, { waitUntil: 'networkidle2', timeout: 180000 })
    check('El contador no entra al registro gerencial', !p2.url().includes('/gerencia'), p2.url().replace(BASE, ''))
  } finally {
    if (browser) await browser.close()
    for (const uid of usuarios) { await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid) }
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
