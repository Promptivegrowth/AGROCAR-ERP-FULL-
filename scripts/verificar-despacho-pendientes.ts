/**
 * Despacho muestra solo lo que va en camión: ni ventas de oficina ni ventas
 * directas. Solo mira.
 *   BASE=https://agrocar-erp-full.vercel.app npx tsx scripts/verificar-despacho-pendientes.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3014'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const sello = Date.now(); const cred = { correo: `zz.desp.${sello}@agrocar.pe`, clave: `Zd-${sello}-t!` }
  const { data: cr } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = cr!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Despacho', role: 'administrador', activo: true } as never)
  let browser: Browser | null = null
  let ok = true
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 1000 }); await page.setBypassServiceWorker(true)
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 180000 })
    for (let i = 0; i < 5; i++) {
      await esperar(3000)
      await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.type('input[type="email"]', cred.correo); await page.type('input[type="password"]', cred.clave)
      await esperar(800)
      if (await page.evaluate((c) => (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === c, cred.correo)) break
    }
    await page.keyboard.press('Enter')
    for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)
    await page.goto(`${BASE}/despacho`, { waitUntil: 'networkidle2', timeout: 180000 }); await esperar(6000)
    const t = await page.evaluate(() => document.body.innerText)
    const pend = t.match(/Pendientes \((\d+)\)/)?.[1]
    const oficina = /VENTA OFICINA/i.test(t)
    console.log(`\n  Pendientes en Despacho: ${pend} · ¿aparece VENTA OFICINA?: ${oficina ? 'sí' : 'no'} · ¿Natalia/Elsa?: ${/NATALIA HUANCA/.test(t) && /ELSA VERONICA/.test(t) ? 'sí' : 'no'}\n`)
    ok = pend === '2' && !oficina
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  if (!ok) process.exit(1)
}
main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
