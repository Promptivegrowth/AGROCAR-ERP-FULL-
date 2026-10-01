/**
 * Al imprimir un lote con varias ticketeras, se elige: no sale solo por Caja.
 *
 * Daniel: "no me da opción de escoger la impresora, se va de frente a la caja".
 * Abre los comprobantes de un carro en formato ticket y comprueba que aparece
 * un botón por ticketera y que NO se mandó nada a la cola. No aprieta ningún
 * botón: las ticketeras son reales y están encendidas.
 *
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-elegir-ticketera.ts
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
const sello = Date.now()
const ADMIN = { correo: `zz.ticket.${sello}@agrocar.pe`, clave: `Zt-${sello}-t!` }
const resultados: boolean[] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push(ok)
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  console.log(`\nELEGIR TICKETERA AL IMPRIMIR UN CARRO — ${BASE}\n`)
  const { data: equipos } = await (admin as any).from('equipos_impresion').select('nombre').eq('activo', true)
  const { data: desp } = await (admin as any).from('despachos').select('id, numero').order('created_at', { ascending: false }).limit(1).single()
  const contarCola = async () => (await (admin as any).from('cola_impresion').select('id', { count: 'exact', head: true })).count ?? 0
  const antes = await contarCola()

  const { data: creado } = await admin.auth.admin.createUser({ email: ADMIN.correo, password: ADMIN.clave, email_confirm: true })
  const userId = creado!.user!.id
  await admin.from('profiles').upsert({ id: userId, email: ADMIN.correo, full_name: 'ZZ Ticketera', role: 'administrador', activo: true } as never)

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1300, height: 1000 })
    await page.setBypassServiceWorker(true)
    // Por si acaso: que el diálogo del navegador no bloquee la prueba.
    await page.evaluateOnNewDocument(() => { window.print = () => {} })
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 180000 })
    for (let i = 0; i < 5; i++) {
      await esperar(3000)
      await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.type('input[type="email"]', ADMIN.correo)
      await page.type('input[type="password"]', ADMIN.clave)
      await esperar(800)
      if (await page.evaluate((c) => (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === c, ADMIN.correo)) break
    }
    await page.keyboard.press('Enter')
    for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)

    await page.goto(`${BASE}/comprobante/imprimir-lote?despacho=${desp.id}&formato=ticket`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(12000)
    const botones = await page.$$eval('[data-ticketera]', (b) => b.map((x) => (x as HTMLElement).innerText.trim()))
    check('Pregunta en qué ticketera imprimir', await page.$('[data-elegir-ticketera]') !== null)
    check('Un botón por cada ticketera', botones.length === equipos.length, botones.join(' | '))
    const despues = await contarCola()
    check('No mandó nada a imprimir solo', despues === antes, `cola antes ${antes}, después ${despues}`)
    await page.screenshot({ path: '.sunat/elegir-ticketera.png' })

    // El comprobante suelto: lo mismo, un botón por ticketera.
    const { data: uno } = await (admin as any).from('comprobantes').select('id, serie, numero')
      .eq('tipo', 'boleta').order('numero').limit(1).single()
    await page.goto(`${BASE}/comprobante/${uno.id}`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(8000)
    const suelto = await page.$$eval('[data-ticketera]', (b) => b.map((x) => (x as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))
    check(`Comprobante suelto ${uno.serie}-${uno.numero}: un botón por ticketera`, suelto.length === equipos.length, suelto.join(' | '))
    check('Tampoco mandó nada solo', (await contarCola()) === antes)
    await page.screenshot({ path: '.sunat/elegir-ticketera-suelto.png' })
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
  }
  const bien = resultados.filter(Boolean).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}
main().catch((e) => { console.error('\nFALLÓ:', e.stack); process.exit(1) })
