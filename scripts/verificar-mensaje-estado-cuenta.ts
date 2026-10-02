/**
 * El mensaje de WhatsApp del estado de cuenta: detallado y con un enlace que
 * se pueda abrir. Daniel, 01/10. Solo mira.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-mensaje-estado-cuenta.ts <cliente_id>
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
const res: boolean[] = []
const check = (q: string, ok: boolean, d = '') => { res.push(ok); console.log(`  ${ok ? 'OK  ' : 'MAL '} ${q}${d ? `  — ${d}` : ''}`) }
async function main() {
  const clienteId = process.argv[2]
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const sello = Date.now(); const cred = { correo: `zz.ec.${sello}@agrocar.pe`, clave: `Zx-${sello}-t!` }
  const { data: cr } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = cr!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ EC', role: 'administrador', activo: true } as never)
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage(); await page.setBypassServiceWorker(true)
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
    await page.goto(`${BASE}/reportes/cobranzas-cliente/${clienteId}`, { waitUntil: 'networkidle2', timeout: 180000 }); await esperar(3000)
    const href = await page.$eval('[data-whatsapp-estado]', (a) => (a as HTMLAnchorElement).href).catch(() => '')
    const msg = href ? decodeURIComponent(href.split('?text=')[1] ?? '') : ''
    console.log('\n----- MENSAJE -----\n' + msg + '\n-------------------\n')
    const url = msg.match(/Detalle completo: (\S+)/)?.[1] ?? ''
    check('El enlace lleva el dominio', /^https?:\/\//.test(url), url)
    check('Detalla los comprobantes', /Comprobantes pendientes \(\d+\)/.test(msg) && /• [FBT]\d{3}-\d{8}/.test(msg))
    check('Lleva las cuentas para pagar', msg.includes('540-2109937-0-38') && msg.includes('952901119'))
    if (url) {
      const r = await fetch(url, { redirect: 'manual' })
      check('El enlace abre sin usuario', r.status === 200, `HTTP ${r.status}`)
    }
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}
main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
