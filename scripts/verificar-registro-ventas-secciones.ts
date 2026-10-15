/**
 * Registro de ventas: detalle separado en facturas, boletas y documentos
 * internos, cada uno por fecha y correlativo con su subtotal (Daniel, 14/10). Solo mira.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-registro-ventas-secciones.ts
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
  const cred = { correo: `zz.rvse.${sello}@agrocar.pe`, clave: `Zc-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Registro secciones', role: 'gerente', activo: true })
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
    await page.goto(`${BASE}/gerencia/registro-ventas`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(9000)
    const r: any = await page.evaluate(`(() => {
      const secciones = []
      let actual = null
      for (const tr of Array.from(document.querySelectorAll('[data-tabla="detalle"] tbody tr'))) {
        const s = tr.getAttribute('data-seccion'), st = tr.getAttribute('data-subtotal')
        if (s) { actual = { tipo: s, docs: [], fechas: [], subtotal: '', titulo: tr.textContent ?? '' }; secciones.push(actual) }
        else if (st && actual) actual.subtotal = tr.querySelectorAll('td')[3]?.textContent ?? ''
        else if (tr.hasAttribute('data-fila-venta') && actual) {
          const td = tr.querySelectorAll('td'); actual.docs.push(td[2]?.textContent ?? ''); actual.fechas.push(td[0]?.textContent ?? '')
        }
      }
      function tarjeta(t) { return Array.from(document.querySelectorAll('p')).find((p) => p.textContent?.trim().toUpperCase() === t)?.nextElementSibling?.textContent ?? '' }
      return { secciones, cards: { factura: tarjeta('FACTURAS'), boleta: tarjeta('BOLETAS'), nota_pedido_interna: tarjeta('DOC. INTERNOS') } }
    })()`)
    const orden = r.secciones.map((s: any) => s.tipo).join(' > ')
    console.log('   bloques:', r.secciones.map((s: any) => `${s.tipo} (${s.docs.length}) ${s.titulo.split('·').slice(-1)[0].trim()}`).join(' | '))
    check('El detalle está separado en Facturas > Boletas > Documentos internos', orden.startsWith('factura > boleta > nota_pedido_interna'), orden)
    for (const s of r.secciones) {
      check(`${s.tipo}: solo documentos de su serie`, s.docs.every((d: string) => (s.tipo === 'factura' ? /^F/ : s.tipo === 'boleta' ? /^B/ : /^T/).test(d)))
      const clave = s.docs.map((d: string, i: number) => s.fechas[i].split('/').reverse().join('') + d)
      check(`${s.tipo}: ordenado por fecha y correlativo`, clave.every((k: string, i: number) => i === 0 || clave[i - 1] <= k))
      const card = (r.cards as any)[s.tipo]
      const num = (x: string) => Number(x.replace(/[^\d.]/g, ''))
      if (card) check(`${s.tipo}: el subtotal coincide con la tarjeta de totales`, Math.abs(num(s.subtotal) - num(card)) < 0.01, `${s.subtotal} / ${card}`)
    }
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
    const xl = await page.evaluate(async (h) => {
      const x = await fetch(`/api/gerencia/registro-ventas/excel?desde=${h.slice(0, 8)}01&hasta=${h}`)
      const b = new Uint8Array(await x.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
      return { status: x.status, b64: btoa(s) }
    }, hoy)
    fs.writeFileSync('.sunat/registro-ventas-prueba.xlsx', Buffer.from(xl.b64, 'base64'))
    check('El Excel se descarga', xl.status === 200, `${xl.status}`)
    await page.screenshot({ path: '.sunat/registro-secciones.png' })
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
