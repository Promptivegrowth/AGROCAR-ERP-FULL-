/**
 * Cuotas y ventas por vendedor: Dashboard, Alcance de objetivos y Gestión de
 * vendedores deben mostrar la misma venta y la cuota completa (Daniel, 15/10).
 * Solo mira.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-cuotas-vendedor.ts
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
const num = (s: string) => Number(String(s).replace(/[^\d.-]/g, ''))
const igual = (s: string, n: number) => Math.abs(num(s) - n) < 0.015

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const { data: dan } = await admin.from('profiles').select('id, full_name').ilike('full_name', 'DANIEL CAICHIHUA%').single()
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
  const A = Number(hoy.slice(0, 4)), M = Number(hoy.slice(5, 7))
  const fin = new Date(Date.UTC(A, M, 0)).toISOString().slice(0, 10)
  // Lo esperado, directo de la base: comprobantes del mes del vendedor del pedido.
  const comps: any[] = []
  for (let i = 0; ; i += 1000) {
    const { data } = await admin.from('comprobantes').select('tipo, comprobantes_items(subtotal), pedidos!inner(vendedor_id)')
      .eq('pedidos.vendedor_id', dan.id).neq('estado', 'anulado').gte('fecha_emision', `${hoy.slice(0, 8)}01`).lte('fecha_emision', fin).range(i, i + 999)
    comps.push(...(data ?? [])); if ((data ?? []).length < 1000) break
  }
  const ventaEsperada = Math.round(comps.reduce((a, c) => a + (c.tipo === 'nota_credito' ? -1 : 1)
    * (c.comprobantes_items ?? []).reduce((s: number, i: any) => s + Number(i.subtotal), 0), 0) * 100) / 100
  const { data: cu } = await admin.from('cuotas_vendedor_producto').select('cuota_valor').eq('vendedor_id', dan.id).eq('anio', A).eq('mes', M)
  const cuotaEsperada = Math.round((cu ?? []).reduce((a: number, c: any) => a + Number(c.cuota_valor), 0) * 100) / 100
  console.log(`\nEsperado (base) ${dan.full_name} ${hoy.slice(0, 7)}: venta S/ ${S(ventaEsperada)} · cuota S/ ${S(cuotaEsperada)}\n`)

  const sello = Date.now()
  const cred = { correo: `zz.cuov.${sello}@agrocar.pe`, clave: `Zq-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Cuotas vendedor', role: 'gerente', activo: true })
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

    // 1) Gestión de vendedores
    await page.goto(`${BASE}/vendedores`, { waitUntil: 'networkidle2', timeout: 180000 }); await esperar(8000)
    const g: any = await page.evaluate(`(() => {
      const card = Array.from(document.querySelectorAll('div')).filter((d) => d.querySelector('[data-cuota-mes]') && d.textContent.includes('DANIEL CAICHIHUA')).pop()
      const val = (sel) => card && card.querySelector(sel) ? card.querySelector(sel).querySelectorAll('p')[1].textContent : ''
      return { cuota: val('[data-cuota-mes]'), ventas: val('[data-ventas-mes]'), kpiCuotas: /cuotas del mes/i.test(document.body.innerText) }
    })()`)
    check('Gestión: la venta del mes de Daniel coincide con la base', igual(g.ventas, ventaEsperada), g.ventas)
    check('Gestión: muestra su cuota del mes completa', igual(g.cuota, cuotaEsperada), g.cuota)
    check('Gestión: tarjeta "Cuotas del mes" arriba', g.kpiCuotas)
    await page.screenshot({ path: '.sunat/gestion-vendedores.png' })

    // 2) Alcance de objetivos: Daniel y "todos"
    await page.goto(`${BASE}/reportes/alcance-objetivos?vendedor=${dan.id}&mes=${M}&anio=${A}`, { waitUntil: 'networkidle2', timeout: 180000 }); await esperar(7000)
    const al: any = await page.evaluate(`(() => {
      const tr = Array.from(document.querySelectorAll('tr')).find((t) => t.textContent.includes('TOTAL GENERAL'))
      const tds = tr ? Array.from(tr.querySelectorAll('td')).map((x) => x.textContent) : []
      const ths = Array.from(document.querySelectorAll('th')).map((x) => x.textContent)
      return { real: tds[7] || '', cuota: tds[8] || '', ths, todos: Array.from(document.querySelectorAll('option')).some((o) => o.value === 'todos'), pie: document.body.innerText.includes('venta con IGV') }
    })()`)
    check('Alcance: la venta de Daniel coincide', igual(al.real, ventaEsperada), al.real)
    check('Alcance: la cuota de Daniel coincide', igual(al.cuota, cuotaEsperada), al.cuota)
    check('Alcance: columnas de precio promedio de venta y de cuota', al.ths.includes('P. PROM. VENTA') && al.ths.includes('P. PROM. CUOTA'), al.ths.join(' | '))
    check('Alcance: opción "Todos los vendedores"', al.todos)
    check('Alcance: el pie dice "con IGV"', al.pie)
    await page.screenshot({ path: '.sunat/alcance-daniel.png' })
    await page.select('select', 'todos'); await esperar(6000)
    const tod: any = await page.evaluate(`(() => ({ nombre: document.body.innerText.includes('VENDEDOR: TODOS LOS VENDEDORES'), lineas: document.querySelectorAll('tr.linea-header').length }))()`)
    check('Alcance "todos": muestra el objetivo general', tod.nombre && tod.lineas > 0, `${tod.lineas} líneas`)

    // 3) Dashboard → Cuotas
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 180000 }); await esperar(5000)
    await page.evaluate(`(() => { const b = Array.from(document.querySelectorAll('[role=tab]')).find((x) => /cuota/i.test(x.textContent)); if (b) { b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); b.click() } })()`)
    await esperar(7000)
    const d1: any = await page.evaluate(`(() => {
      const kpi = (l) => { const p = Array.from(document.querySelectorAll('p')).find((x) => x.textContent.trim().toUpperCase() === l); return p && p.nextElementSibling ? p.nextElementSibling.textContent : '' }
      const tr = Array.from(document.querySelectorAll('tr')).find((t) => t.textContent.includes('TOTAL GENERAL'))
      const tds = tr ? Array.from(tr.querySelectorAll('td')).map((x) => x.textContent) : []
      return { venta: kpi('TOTAL VENTA'), cuota: kpi('TOTAL CUOTA'), proy: /al cierre del mes/i.test(document.body.innerText), tablaReal: tds[6] || '', tablaCuota: tds[7] || '', tds }
    })()`)
    console.log('   dashboard (todos):', JSON.stringify({ venta: d1.venta, cuota: d1.cuota, tabla: d1.tds }))
    check('Dashboard: total venta = total de la tabla (misma fuente)', d1.venta !== '' && igual(d1.venta, num(d1.tablaReal)), `${d1.venta} / ${d1.tablaReal}`)
    check('Dashboard: total cuota = total de la tabla (cuota completa)', d1.cuota !== '' && igual(d1.cuota, num(d1.tablaCuota)), `${d1.cuota} / ${d1.tablaCuota}`)
    check('Dashboard: "Proyección al cierre del mes"', d1.proy)
    await page.screenshot({ path: '.sunat/dashboard-cuotas.png' })
    check('Sin errores de JavaScript', errores.filter((e) => !/hydrat|server-rendered/i.test(e)).length === 0, errores.join(' // '))
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
