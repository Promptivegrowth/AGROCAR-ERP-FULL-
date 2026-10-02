/**
 * El diálogo "Editar comprobante" ofrece agregar un producto, con precios.
 *
 * Daniel: "en editar comprobante no puedo agregar producto". Solo mira: abre
 * el diálogo y comprueba que el formulario está y que trae los productos con
 * el precio de la lista del cliente. No agrega nada: los comprobantes son
 * reales. (El agregado en sí se probó en la base con un ensayo deshecho.)
 *
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-agregar-producto.ts
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
  console.log(`\nAGREGAR PRODUCTO AL EDITAR — ${BASE}\n`)
  const sello = Date.now()
  const cred = { correo: `zz.edit.${sello}@agrocar.pe`, clave: `Ze-${sello}-t!` }
  const { data: creado } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const userId = creado!.user!.id
  await admin.from('profiles').upsert({ id: userId, email: cred.correo, full_name: 'ZZ Editar', role: 'administrador', activo: true } as never)
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 1000 })
    await page.emulateTimezone('America/Lima')
    await page.setBypassServiceWorker(true)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(String((e as Error).message).slice(0, 120)))
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
    await esperar(6000)
    const tab = await page.$('xpath/.//*[@role="tab"][contains(., "Comprobantes Emitidos")]')
    await tab!.click()
    await esperar(6000)
    const editar = await page.$('xpath/.//button[contains(., "Editar")][@title="Editar comprobante (con auditoría)"]')
    check('Hay un botón Editar en la lista', !!editar)
    if (editar) {
      await editar.click()
      await esperar(5000)
      check('El diálogo tiene "Agregar producto" con buscador', !!(await page.$('[data-agregar-producto] [data-buscar-producto]')))
      await page.type('[data-buscar-producto]', 'queso edam')
      await esperar(800)
      const resultados = await page.$$eval('[data-resultados-producto] button', (b) => b.map((x) => (x as HTMLElement).innerText.replace(/\s+/g, ' ')))
      check('Busca por nombre', resultados.length > 0 && resultados.every((r) => /QUESO EDAM/i.test(r)), resultados.join(' | ').slice(0, 160))
      const primero = await page.$('[data-resultados-producto] button')
      if (primero) await primero.click()
      await esperar(500)
      const elegido = await page.evaluate(() => {
        const caja = document.querySelector('[data-agregar-producto]')!
        const inputs = Array.from(caja.querySelectorAll('input')) as HTMLInputElement[]
        return { texto: inputs[0]?.value ?? '', precio: inputs[2]?.value ?? '' }
      })
      check('Al elegir completa el producto y el precio', /QUESO EDAM/i.test(elegido.texto) && Number(elegido.precio) > 0, `${elegido.texto} · S/ ${elegido.precio}`)
      await page.$eval('[data-buscar-producto]', (el) => { (el as HTMLInputElement).value = '' })
      await page.screenshot({ path: '.sunat/editar-agregar.png' })
    }
    check('Sin errores de JavaScript', errores.length === 0, errores[0] ?? '')
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
  }
  const bien = resultados.filter(Boolean).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}
main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
