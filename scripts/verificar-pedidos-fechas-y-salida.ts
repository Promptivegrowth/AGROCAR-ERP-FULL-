/**
 * Pedidos: el rango de fechas cambia la lista. Y "Productos que salen"
 * consolida bien. Daniel, 03/10. Solo mira.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-pedidos-fechas-y-salida.ts
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
const check = (q: string, ok: boolean, d = '') => {
  res.push(ok)
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${q}${d ? `  — ${d}` : ''}`)
}
const ESTADOS = ['enviado', 'validado', 'facturado', 'despachado']

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const rango = () => admin.from('pedidos').select('id', { count: 'exact', head: true })
    .gte('fecha_pedido', '2026-10-02').lte('fecha_pedido', '2026-10-03')
  const { count: enRango } = await rango()
  const { count: despachados } = await rango().eq('estado', 'despachado')
  const { data: prox } = await admin.from('pedidos').select('fecha_despacho').in('estado', ESTADOS)
    .gte('fecha_despacho', '2026-10-04').order('fecha_despacho').limit(1).single()
  const { data: items } = await admin.from('pedidos_items')
    .select('cantidad, pedidos!inner(fecha_despacho, estado)')
    .eq('pedidos.fecha_despacho', prox.fecha_despacho).in('pedidos.estado', ESTADOS)
  const cantBase = (items ?? []).reduce((a: number, i: any) => a + Number(i.cantidad), 0)
  console.log(`\nBase: ${enRango} pedidos del 02 al 03/10 (${despachados} despachados) · próximo despacho ${prox.fecha_despacho}, cantidad ${cantBase.toFixed(2)}\n`)

  const sello = Date.now()
  const cred = { correo: `zz.pf.${sello}@agrocar.pe`, clave: `Zf-${sello}-t!` }
  const { data: cr } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = cr!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Pedidos fechas', role: 'gerente', activo: true })
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 1000 })
    await page.setBypassServiceWorker(true)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(String((e as Error).message).slice(0, 100)))
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 180000 })
    for (let i = 0; i < 5; i++) {
      await esperar(3000)
      await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.type('input[type="email"]', cred.correo)
      await page.type('input[type="password"]', cred.clave)
      await esperar(800)
      if (await page.evaluate((c) => (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === c, cred.correo)) break
    }
    await page.keyboard.press('Enter')
    for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)

    // Abrir en "hoy" y DESPUÉS cambiar el rango con el campo Desde, como Daniel.
    await page.goto(`${BASE}/pedidos`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(4000)
    const desde = (await page.$$('input[type="date"]'))[0]
    await desde.evaluate((el: any) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(el, '2026-10-02')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await esperar(7000)
    const total = await page.evaluate(() => Number(document.body.innerText.match(/TOTAL\s*\n\s*(\d+)/)?.[1] ?? -1))
    check('Al cambiar el rango, la lista se actualiza', total === enRango, `${page.url().split('?')[1] ?? ''} · total ${total} (base ${enRango})`)
    const tabDesp = await page.$('xpath/.//*[@role="tab"][contains(., "Despachados")]')
    if (tabDesp) { await tabDesp.click(); await esperar(1500) }
    const filasDesp = await page.$$eval('table tbody tr', (x) => x.length).catch(() => 0)
    check('La pestaña Despachados muestra los despachados', filasDesp > 0, `${filasDesp} filas en la página (base ${despachados})`)
    check('Botón "Productos que salen"', !!(await page.$('[data-boton-salida]')))

    await page.goto(`${BASE}/pedidos/salida`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(3000)
    const s = await page.evaluate(() => ({
      fecha: (document.querySelector('[data-fecha-salida]') as HTMLInputElement)?.value,
      titulo: document.querySelector('[data-titulo-salida]')?.textContent ?? '',
      filas: document.querySelectorAll('[data-fila-salida]').length,
      total: document.querySelector('[data-total-cantidad]')?.textContent ?? '',
    }))
    // es-PE: 1.234,50 o 1,234.50 según el entorno; se toma solo dígitos y el último separador.
    const t = s.total.trim()
    const totalPant = Number(t.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'))
    check('Abre en el próximo día de despacho', s.fecha === prox.fecha_despacho, `${s.fecha} · ${s.titulo}`)
    check('Consolida por producto y el total cuadra con la base', s.filas > 0 && Math.abs(totalPant - cantBase) < 0.01,
      `${s.filas} productos · pantalla ${s.total} · base ${cantBase.toFixed(2)}`)
    await page.screenshot({ path: '.sunat/salida.png', fullPage: false })
    check('Sin errores de JavaScript', errores.length === 0, errores[0] ?? '')
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid)
    await admin.auth.admin.deleteUser(uid)
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
