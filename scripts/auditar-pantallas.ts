/**
 * Auditoría de pantallas tras los cambios de SUNAT "en proceso" (11/10/2026):
 * estados, facturación, registro de ventas, comprobante y reportes. Solo mira.
 *   BASE=http://localhost:3014 npx tsx scripts/auditar-pantallas.ts
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
  const cred = { correo: `zz.audp.${sello}@agrocar.pe`, clave: `Zc-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Auditoria pantallas', role: 'administrador', activo: true })
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
    const ir = async (ruta: string, ms = 8000) => { await page.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle2', timeout: 180000 }); await esperar(ms) }
    const texto = () => page.evaluate(() => document.body.innerText)
    const { data: f79 } = await admin.from('comprobantes').select('id, sunat_estado').eq('serie', 'F002').eq('numero', '00000079').maybeSingle()
    const { count: nEnProceso } = await admin.from('comprobantes').select('id', { count: 'exact', head: true }).eq('sunat_estado', 'en_proceso')
    const { count: nAlerta } = await admin.from('comprobantes').select('id', { count: 'exact', head: true }).eq('enviado_sunat', true).in('sunat_verificacion', ['no_existe', 'rechazado', 'baja'])

    // 1) Estado SUNAT
    await ir('/facturacion/sunat', 9000)
    let r: any = await page.evaluate(() => ({
      enProceso: document.querySelectorAll('[data-estado="en_proceso"]').length,
      rechazados: document.querySelectorAll('[data-estado="rechazado"]').length,
      alerta: document.querySelectorAll('[data-estado="alerta"]').length,
      crudo: document.body.innerText.includes('en_proceso'),
    }))
    check('Estado SUNAT: los "en proceso" de la base se ven así', r.enProceso === nEnProceso, `${r.enProceso} en pantalla / ${nEnProceso} en base`)
    check('Estado SUNAT: ninguno como Rechazado', r.rechazados === 0)
    check('Estado SUNAT: "Para revisar" coincide con la base', r.alerta === nAlerta, `${r.alerta} / ${nAlerta}`)
    check('Estado SUNAT: no muestra la clave cruda "en_proceso"', !r.crudo)
    const tarjeta = await page.$('xpath/.//button[contains(., "Pendientes de envío")]')
    if (tarjeta) {
      await tarjeta.click(); await esperar(1500)
      const n = await page.$$eval('[data-estado="en_proceso"]', (x) => x.length)
      check('Estado SUNAT: la tarjeta "Pendientes de envío" incluye los en proceso', n === nEnProceso, `${n}`)
    } else check('Estado SUNAT: existe la tarjeta "Pendientes de envío"', false)
    await page.screenshot({ path: '.sunat/audit-estado-sunat.png' })

    // 2) Facturación: la F002-79 no ofrece Editar ni Anular
    await ir('/facturacion', 9000)
    const pestana = await page.$('xpath/.//button[contains(., "Comprobantes Emitidos")]')
    if (pestana) { await pestana.click(); await esperar(6000) }
    const buscador = await page.$('input[placeholder^="Buscar por número"]')
    if (buscador) { await buscador.type('F002-00000079'); await page.keyboard.press('Enter'); await esperar(6000) }
    r = await page.evaluate(() => {
      const filas = Array.from(document.querySelectorAll('tr')).filter((tr) => tr.textContent?.includes('F002-00000079'))
      const t = filas.map((f) => f.textContent ?? '').join(' ')
      return { filas: filas.length, badge: t.includes('En proceso SUNAT'), editar: t.includes('Editar'), anular: t.includes('Anular'), guia: t.includes('Guía') }
    })
    check('Facturación: aparece la F002-79', r.filas > 0, `${r.filas} fila(s)`)
    check('Facturación: la F002-79 dice "En proceso SUNAT"', r.badge)
    check('Facturación: sin botones Editar ni Anular para ella', !r.editar && !r.anular, JSON.stringify(r))
    await page.evaluate(() => { const f = Array.from(document.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('F002-00000079')); f?.scrollIntoView({ block: 'center' }) })
    await esperar(800)
    await page.screenshot({ path: '.sunat/audit-facturacion.png' })

    // 3) Registro de ventas (y su Excel)
    await ir('/gerencia/registro-ventas', 9000)
    const t3 = await texto()
    check('Registro de ventas: muestra "En proceso en SUNAT"', t3.includes('En proceso en SUNAT'))
    check('Registro de ventas: sin la clave cruda "en_proceso"', !t3.includes('en_proceso'))
    const xl = await page.evaluate(async () => { const x = await fetch('/api/gerencia/registro-ventas/excel?desde=2026-10-09&hasta=2026-10-09'); return { s: x.status, t: x.headers.get('content-type') ?? '' } })
    check('Registro de ventas: el Excel se descarga', xl.s === 200 && /sheet|excel|octet/.test(xl.t), `${xl.s} ${xl.t}`)

    // 4) Comprobante impreso de la F002-79
    if (f79) {
      await ir(`/comprobante/${f79.id}`, 5000)
      r = await page.evaluate(() => ({
        xml: !!document.querySelector('a[href$="/xml"]'), cdr: !!document.querySelector('a[href$="/cdr"]'),
        txt: document.body.innerText.slice(0, 80),
      }))
      check('Comprobante F002-79: abre e incluye su XML', r.xml, r.txt.replace(/\s+/g, ' '))
    }

    // 5) El resto de pantallas tocadas estos días: cargan sin errores
    for (const ruta of ['/facturacion/guias', '/caja', '/caja?dia=2026-10-06', '/almacen', '/almacen/valorizado', '/almacen/movimientos-dia',
      '/pedidos', '/reportes/cuentas-por-cobrar', '/gerencia/utilidad', '/gerencia/registro-compras', '/dashboard']) {
      const antes = errores.length
      await ir(ruta, 6000)
      const t = await texto()
      const nuevos = errores.slice(antes).filter((e) => !/hydrat|server-rendered/i.test(e))
      check(`${ruta}: carga sin errores`, nuevos.length === 0 && !/Application error|Error inesperado/i.test(t), nuevos.join(' // '))
    }
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
