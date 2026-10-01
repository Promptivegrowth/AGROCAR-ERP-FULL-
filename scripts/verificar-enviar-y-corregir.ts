/**
 * Enviar documentos al cliente y corregir el medio de pago, en vivo.
 *
 * Solo mira: no guarda la corrección ni envía nada.
 *
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-enviar-y-corregir.ts
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
const resultados: boolean[] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push(ok)
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  console.log(`\nENVIAR DOCUMENTOS Y CORREGIR MEDIO DE PAGO — ${BASE}\n`)
  const { data: comp } = await (admin as any).from('comprobantes').select('id, serie, numero').eq('serie', 'F002').eq('numero', '00000015').single()
  const { data: guia } = await (admin as any).from('guias_remision').select('id').eq('serie', 'T002').eq('numero', 7).single()

  // Sin sesión: comprobante y guía (lo que recibe el cliente)
  let browser: Browser | null = null
  const sello = Date.now()
  const cred = { correo: `zz.env.${sello}@agrocar.pe`, clave: `Zv-${sello}-t!` }
  const { data: creado } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const userId = creado!.user!.id
  await admin.from('profiles').upsert({ id: userId, email: cred.correo, full_name: 'ZZ Enviar', role: 'administrador', activo: true } as never)
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1400, height: 1000 })
    await page.setBypassServiceWorker(true)

    const enlaces = async () => page.evaluate(() => ({
      wa: (document.querySelector('[data-whatsapp]') as HTMLAnchorElement | null)?.href ?? '',
      correo: (document.querySelector('[data-correo]') as HTMLAnchorElement | null)?.href ?? '',
    }))

    await page.goto(`${BASE}/comprobante/${comp.id}`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(2500)
    let e = await enlaces()
    let texto = decodeURIComponent(e.wa)
    check('Comprobante: botón WhatsApp', e.wa.startsWith('https://wa.me/'), e.wa.slice(0, 40))
    check('…lleva el PDF en A4 y el XML', texto.includes(`/comprobante/${comp.id}?formato=a4`) && texto.includes(`/api/documentos/comprobante/${comp.id}/xml`))
    check('…y dice qué es', texto.includes('Factura F002-00000015'))
    check('Comprobante: botón correo', e.correo.startsWith('mailto:') && decodeURIComponent(e.correo).includes('Factura F002-00000015 - AGROCAR'))

    await page.goto(`${BASE}/guia/${guia.id}`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(2500)
    e = await enlaces()
    texto = decodeURIComponent(e.wa)
    check('Guía: botón WhatsApp con PDF, XML y constancia', texto.includes(`/guia/${guia.id}`)
      && texto.includes(`/api/documentos/guia/${guia.id}/xml`) && texto.includes(`/api/documentos/guia/${guia.id}/cdr`))

    // Con sesión: Facturación y Caja
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

    await page.goto(`${BASE}/facturacion`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(5000)
    const tab = await page.$('xpath/.//*[@role="tab"][contains(., "Comprobantes Emitidos")]')
    await tab!.click()
    await esperar(5000)
    const enLista = await page.$$eval('[data-enviar-documento]', (x) => x.length)
    check('Facturación: enviar en cada comprobante', enLista > 50, `${enLista} filas con WhatsApp/correo`)

    await page.goto(`${BASE}/caja`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(6000)
    const botones = await page.$$('[data-corregir-pago]')
    check('Caja: botón "Corregir medio de pago"', botones.length > 0, `${botones.length} cobros`)
    // Abrir el del cobro de la venta directa de Víctor (María Candelaria, S/ 356)
    const fila = await page.$('xpath/.//tr[contains(., "MARIA CANDELARIA TINTAYA LARICO") and contains(., "356")]')
    const boton = fila ? await fila.$('[data-corregir-pago]') : null
    if (boton) {
      await boton.click()
      await esperar(1500)
      const dlg = await page.evaluate(() => (document.querySelector('[role="dialog"]') as HTMLElement | null)?.innerText ?? '')
      check('El diálogo abre con el cobro', /Corregir medio de pago/.test(dlg) && /MARIA CANDELARIA/.test(dlg), dlg.replace(/\s+/g, ' ').slice(0, 90))
      await page.screenshot({ path: '.sunat/corregir-pago.png' })
    } else {
      check('El diálogo abre con el cobro', false, 'no se encontró la fila de la venta directa')
    }
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
  }
  const { data: cobro } = await (admin as any).from('cobros').select('efectivo, yape').eq('numero', 'R-202610-000030').single()
  check('No se modificó el cobro', Number(cobro.efectivo) === 356 && Number(cobro.yape) === 0)
  const bien = resultados.filter(Boolean).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}
main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
