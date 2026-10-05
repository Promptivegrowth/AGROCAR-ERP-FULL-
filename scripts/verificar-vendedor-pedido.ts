/**
 * Asignar vendedor a un pedido guardado (Daniel, 05/10). Solo mira: la RPC se
 * prueba con un pedido inexistente y en la pantalla no se guarda nada.
 *   BASE=http://localhost:3014 PEDIDO=P-41843536 npx tsx scripts/verificar-vendedor-pedido.ts
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
  const { data: ped } = await admin.from('pedidos').select('id, numero, fecha_pedido, vendedor_id').eq('numero', process.env.PEDIDO ?? 'P-41843536').single()
  const sello = Date.now()
  const usuarios: string[] = []
  const crear = async (rol: string) => {
    const cred = { correo: `zz.vp.${rol}.${sello}@agrocar.pe`, clave: `Zv-${sello}-t!` }
    const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
    usuarios.push(data!.user!.id)
    await admin.from('profiles').upsert({ id: data!.user!.id, email: cred.correo, full_name: `ZZ VP ${rol}`, role: rol, activo: true })
    return cred
  }
  const fact = await crear('facturador')
  const vend = await crear('vendedor')
  let browser: Browser | null = null
  try {
    const c1 = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!) as any
    await c1.auth.signInWithPassword({ email: fact.correo, password: fact.clave })
    const r1 = await c1.rpc('asignar_vendedor_pedido', { p_pedido_id: randomUUID(), p_vendedor_id: randomUUID() })
    check('La RPC responde (parámetros bien)', /no existe/i.test(r1.error?.message ?? ''), r1.error?.message)
    const c2 = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!) as any
    await c2.auth.signInWithPassword({ email: vend.correo, password: vend.clave })
    const r2 = await c2.rpc('asignar_vendedor_pedido', { p_pedido_id: ped.id, p_vendedor_id: randomUUID() })
    check('Un vendedor no puede reasignar pedidos', /Solo administraci/i.test(r2.error?.message ?? ''), r2.error?.message)

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
      await page.type('input[type="email"]', fact.correo); await page.type('input[type="password"]', fact.clave)
      await esperar(800)
      if (await page.evaluate((c) => (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === c, fact.correo)) break
    }
    await page.keyboard.press('Enter')
    for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)
    await page.goto(`${BASE}/pedidos?desde=${ped.fecha_pedido}&hasta=${ped.fecha_pedido}`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(4000)
    const todos = await page.$('xpath/.//*[@role="tab"][contains(., "Todos")]')
    if (todos) { await todos.click(); await esperar(1500) }
    const busq = await page.$('input[placeholder*="Buscar"]')
    if (busq) { await busq.type(ped.numero); await esperar(2500) }
    const fila = await page.$(`xpath/.//tr[contains(., "${ped.numero}")]`)
    check('El pedido aparece en la lista', !!fila, ped.numero)
    const ojo = await fila!.$("button")
    await (ojo ?? fila!).click(); await esperar(3000)
    const enlace = await page.$('[data-asignar-vendedor]')
    const texto = await page.$eval('[data-vendedor-pedido]', (e) => e.textContent ?? '').catch(() => '')
    check('El detalle muestra "Asignar" junto al vendedor', !!enlace, texto.trim().slice(0, 60))
    await enlace!.click(); await esperar(2500)
    const opciones = await page.$$eval('select[aria-label="Vendedor"] option', (o) => o.map((x) => x.textContent))
    check('Se abre la lista de vendedores activos', opciones.length > 1, opciones.slice(1, 4).join(', '))
    await page.screenshot({ path: '.sunat/vendedor-pedido.png' })
    check('Sin errores de JavaScript', errores.length === 0, errores[0] ?? '')
  } finally {
    if (browser) await browser.close()
    for (const uid of usuarios) { await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid) }
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
