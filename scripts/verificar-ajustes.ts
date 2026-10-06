/**
 * Ajustes de inventario (05/10): la RPC mueve el stock y la pantalla la usa.
 * Solo mira: la RPC se prueba con un producto inexistente y el formulario no
 * se envía. Que el stock se mueva lo probó el ensayo de la migración 129.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-ajustes.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
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

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const sello = Date.now()
  const usuarios: string[] = []
  const crear = async (rol: string) => {
    const cred = { correo: `zz.aj.${rol}.${sello}@agrocar.pe`, clave: `Zj-${sello}-t!` }
    const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
    usuarios.push(data!.user!.id)
    await admin.from('profiles').upsert({ id: data!.user!.id, email: cred.correo, full_name: `ZZ Ajuste ${rol}`, role: rol, activo: true })
    return cred
  }
  const alm = await crear('almacenero')
  const vend = await crear('vendedor')
  let browser: Browser | null = null
  try {
    const c1 = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!) as any
    await c1.auth.signInWithPassword({ email: alm.correo, password: alm.clave })
    const r1 = await c1.rpc('registrar_ajuste_inventario', { p_producto_id: randomUUID(), p_tipo: 'entrada', p_cantidad: 1, p_motivo: 'Producción', p_notas: null, p_costo_unitario: 1 })
    check('La RPC responde (parámetros bien)', /no existe/i.test(r1.error?.message ?? ''), r1.error?.message)
    const c2 = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!) as any
    await c2.auth.signInWithPassword({ email: vend.correo, password: vend.clave })
    const r2 = await c2.rpc('registrar_ajuste_inventario', { p_producto_id: randomUUID(), p_tipo: 'entrada', p_cantidad: 1, p_motivo: 'x' })
    check('Un vendedor no puede ajustar el inventario', /Solo administraci/i.test(r2.error?.message ?? ''), r2.error?.message)

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
      await page.type('input[type="email"]', alm.correo); await page.type('input[type="password"]', alm.clave)
      await esperar(800)
      if (await page.evaluate((x) => (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === x, alm.correo)) break
    }
    await page.keyboard.press('Enter')
    for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)
    await page.goto(`${BASE}/almacen/ajustes`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(3500)
    const texto = await page.evaluate(() => document.querySelector('main')?.innerText ?? document.body.innerText)
    check('La lista ya no mezcla compras ni ventas', !/Entrada por compra|Salida por|Despacho D-/i.test(texto))
    const nuevo = await page.$('xpath/.//button[normalize-space(.)="Nuevo Ajuste"]')
    await nuevo!.click(); await esperar(1500)
    check('En una entrada aparece "Costo unitario"', !!(await page.$('[data-costo-ajuste]')))
    await page.screenshot({ path: '.sunat/ajuste.png' })
    check('Sin errores de JavaScript', errores.length === 0, errores[0] ?? '')
  } finally {
    if (browser) await browser.close()
    for (const uid of usuarios) { await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid) }
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
