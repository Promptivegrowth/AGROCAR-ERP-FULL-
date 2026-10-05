/**
 * Corregir / anular cobro (Daniel, 05/10). No modifica ningún cobro real: las
 * RPC se llaman con un cobro inexistente y la pantalla se recorre sin guardar.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-corregir-cobro.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
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

async function entrar(page: Page, correo: string, clave: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 180000 })
  for (let i = 0; i < 5; i++) {
    await esperar(3000)
    await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
    await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
    await page.type('input[type="email"]', correo)
    await page.type('input[type="password"]', clave)
    await esperar(800)
    if (await page.evaluate((c) => (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === c, correo)) break
  }
  await page.keyboard.press('Enter')
  for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const sello = Date.now()
  const usuarios: string[] = []
  const crear = async (rol: string) => {
    const cred = { correo: `zz.cc.${rol}.${sello}@agrocar.pe`, clave: `Zc-${sello}-t!` }
    const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
    usuarios.push(data!.user!.id)
    await admin.from('profiles').upsert({ id: data!.user!.id, email: cred.correo, full_name: `ZZ Cobro ${rol}`, role: rol, activo: true })
    return cred
  }
  const gerente = await crear('gerente')
  const vendedor = await crear('vendedor')
  let browser: Browser | null = null
  try {
    // 1) Las RPC desde la API, con un cobro que no existe.
    const comoGerente = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!) as any
    await comoGerente.auth.signInWithPassword({ email: gerente.correo, password: gerente.clave })
    const falso = randomUUID()
    const r1 = await comoGerente.rpc('corregir_cobro', { p_cobro_id: falso, p_cliente_id: null, p_efectivo: 10, p_yape: 0, p_plin: 0, p_transferencia: 0, p_nro_operacion: null, p_motivo: 'prueba' })
    check('corregir_cobro responde (parámetros bien)', /no existe/i.test(r1.error?.message ?? ''), r1.error?.message)
    const r2 = await comoGerente.rpc('anular_cobro', { p_cobro_id: falso, p_motivo: 'prueba' })
    check('anular_cobro responde (parámetros bien)', /no existe/i.test(r2.error?.message ?? ''), r2.error?.message)
    const comoVendedor = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!) as any
    await comoVendedor.auth.signInWithPassword({ email: vendedor.correo, password: vendedor.clave })
    const r3 = await comoVendedor.rpc('anular_cobro', { p_cobro_id: falso, p_motivo: 'prueba' })
    check('Un vendedor no puede anular', /Solo administraci/i.test(r3.error?.message ?? ''), r3.error?.message)
    const r4 = await comoVendedor.rpc('_cobro_modificable', { p_cobro_id: falso, p_motivo: 'x', p_accion: 'x' })
    check('La función interna no se puede llamar desde afuera', !!r4.error, r4.error?.message?.slice(0, 60))

    // 2) La pantalla, sin guardar.
    const { data: ultimo } = await admin.from('cobros').select('numero, total, clientes(razon_social)').not('cliente_id', 'is', null).order('created_at', { ascending: false }).limit(1).single()
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 950 })
    await page.setBypassServiceWorker(true)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(String((e as Error).message).slice(0, 120)))
    await entrar(page, gerente.correo, gerente.clave)
    await page.goto(`${BASE}/caja`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(4000)
    const boton = await page.$('[data-buscar-cobro]')
    check('Caja muestra "Corregir un cobro de otro día"', !!boton)
    await boton!.click(); await esperar(1000)
    await page.type('input[placeholder^="N° de recibo"]', ultimo.numero)
    await esperar(3000)
    const fila = await page.$('xpath/.//button[contains(., "' + ultimo.numero + '")]')
    check('El buscador encuentra el cobro por número', !!fila, ultimo.numero)
    await fila!.click(); await esperar(2500)
    const dlg = await page.$('[data-dialogo-cobro]')
    check('Se abre el diálogo de corrección', !!dlg)
    const aplicado = await page.evaluate(() => document.querySelector('[data-dialogo-cobro]')?.textContent?.includes('Aplicado a:') ?? false)
    check('Muestra a qué comprobantes está aplicado', aplicado)
    const guardarDeshab = await page.$eval('[data-guardar]', (b) => (b as HTMLButtonElement).disabled)
    check('Sin cambios ni motivo, "Guardar" está deshabilitado', guardarDeshab)
    await page.$eval('[data-monto="efectivo"]', (e) => { (e as HTMLInputElement).select() })
    await page.type('[data-monto="efectivo"]', String(Number(ultimo.total) + 5))
    await page.type('[data-motivo]', 'prueba')
    await esperar(500)
    const totalTxt = await page.$eval('[data-total-nuevo]', (e) => e.textContent ?? '')
    const habil = await page.$eval('[data-guardar]', (b) => !(b as HTMLButtonElement).disabled)
    check('Al cambiar el monto avisa el total nuevo y habilita Guardar', /antes/.test(totalTxt) && habil, totalTxt.slice(0, 80))
    await page.screenshot({ path: '.sunat/cobro-corregir.png' })
    await page.click('[data-ir-a-anular]'); await esperar(700)
    const anularDeshab = await page.$eval('[data-anular]', (b) => (b as HTMLButtonElement).disabled)
    await page.click('[data-confirma-anular]'); await esperar(300)
    const anularHabil = await page.$eval('[data-anular]', (b) => !(b as HTMLButtonElement).disabled)
    check('Anular pide confirmación antes de habilitarse', anularDeshab && anularHabil)
    await page.screenshot({ path: '.sunat/cobro-anular.png' })
    check('Sin errores de JavaScript', errores.length === 0, errores[0] ?? '')
    // No se guarda nada: se cierra.
  } finally {
    if (browser) await browser.close()
    for (const uid of usuarios) { await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid) }
  }
  console.log(`\n  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.\n`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
