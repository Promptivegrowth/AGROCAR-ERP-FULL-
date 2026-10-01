/**
 * Cuántas hojas ocupa el catálogo impreso, y en qué orientación.
 *
 * Daniel: "el catálogo de productos en PDF pero vertical, para que entre en
 * pocas hojas". Genera el PDF igual que Chrome al imprimir (respetando el
 * @page de la pantalla) y cuenta las páginas.
 *
 *   BASE=http://localhost:3014 npx tsx scripts/medir-catalogo-pdf.ts
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

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const sello = Date.now()
  const cred = { correo: `zz.cat.${sello}@agrocar.pe`, clave: `Zc-${sello}-t!` }
  const { data: creado } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const userId = creado!.user!.id
  await admin.from('profiles').upsert({ id: userId, email: cred.correo, full_name: 'ZZ Catálogo', role: 'administrador', activo: true } as never)
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setBypassServiceWorker(true)
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

    await page.goto(`${BASE}/reportes/catalogo`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(4000)
    const productos = await page.evaluate(() => document.querySelectorAll('.cat-doc tbody tr').length)
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    fs.writeFileSync('.sunat/catalogo.pdf', pdf)
    const texto = Buffer.from(pdf).toString('latin1')
    const paginas = (texto.match(/\/Type\s*\/Page[^s]/g) ?? []).length
    const caja = texto.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/)
    const orientacion = caja ? (Number(caja[1]) < Number(caja[2]) ? 'vertical' : 'horizontal') : '?'
    console.log(`\n  ${productos} productos → ${paginas} hojas, ${orientacion} (${caja?.[1]}×${caja?.[2]} pt)\n`)
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
  }
}
main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
