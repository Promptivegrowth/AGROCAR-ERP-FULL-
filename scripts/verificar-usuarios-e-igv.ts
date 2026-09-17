/**
 * Las dos observaciones de Daniel, en la pantalla de verdad.
 *
 *   1. "cuando editas haces cambio de rol no guarda, sale error"
 *   2. "habilitar en configuración una opción para cambiar el IGV, solo debe
 *      tener acceso el administrador y gerencia"
 *
 * Se entra con un administrador y con un vendedor, para comprobar las dos
 * caras del permiso. Todos los usuarios son temporales y se borran al terminar.
 *
 *   BASE=http://localhost:3012 npx tsx scripts/verificar-usuarios-e-igv.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3012'

function cargarEnvLocal() {
  const f = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(f)) return
  for (const linea of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const env = (n: string) => {
  const v = process.env[n]
  if (!v) throw new Error(`Falta ${n}`)
  return v
}

const sello = Date.now()
const ADMIN = { correo: `zz.admin.${sello}@agrocar.pe`, clave: `Za-${sello}-t!` }
const VEND = { correo: `zz.vend.${sello}@agrocar.pe`, clave: `Zv-${sello}-t!` }
const BLANCO = { correo: `zz.blanco.${sello}@agrocar.pe`, clave: `Zb-${sello}-t!` }
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log('\nUSUARIOS E IGV, EN LA PANTALLA\n')

  const creados: string[] = []
  let browser: Browser | null = null
  try {
    const crear = async (u: { correo: string; clave: string }, rol: string, nombre: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: u.correo, password: u.clave, email_confirm: true,
      })
      if (error) throw error
      const id = data.user!.id
      creados.push(id)
      await admin.from('profiles').upsert({
        id, email: u.correo, full_name: nombre, role: rol, activo: true,
      } as never)
      return id
    }

    await crear(ADMIN, 'administrador', 'ZZ Admin de prueba')
    await crear(VEND, 'vendedor', 'ZZ Vendedor de prueba')
    const idBlanco = await crear(BLANCO, 'vendedor', 'ZZ Usuario a editar')

    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })

    const entrar = async (u: { correo: string; clave: string }) => {
      const page = await browser!.newPage()
      await page.setViewport({ width: 1500, height: 1000 })
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 })
      await page.type('input[type="email"]', u.correo)
      await page.type('input[type="password"]', u.clave)
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
        page.keyboard.press('Enter'),
      ])
      await esperar(6000)
      return page
    }

    const irASeries = async (page: any) => {
      await page.goto(`${BASE}/configuracion`, { waitUntil: 'networkidle2', timeout: 90000 })
      await esperar(7000)
      for (const t of await page.$$('[role="tab"]')) {
        const txt = await t.evaluate((e: Element) => e.textContent ?? '')
        if (/serie/i.test(txt)) { await t.click(); break }
      }
      await esperar(4000)
    }

    // ══ 1. El administrador ══════════════════════════════════════════════
    const pAdmin = await entrar(ADMIN)
    check('El administrador entra', !pAdmin.url().includes('/login'))

    const fallidas: string[] = []
    pAdmin.on('response', async (r: any) => {
      if (r.status() >= 400 && !r.url().includes('favicon')) {
        let cuerpo = ''
        try { cuerpo = (await r.text()).slice(0, 160) } catch { /* sin cuerpo */ }
        fallidas.push(`HTTP ${r.status()} ${cuerpo}`)
      }
    })

    // ── Cambiar el rol ───────────────────────────────────────────────────
    await pAdmin.goto(`${BASE}/configuracion`, { waitUntil: 'networkidle2', timeout: 90000 })
    await esperar(7000)
    for (const t of await pAdmin.$$('[role="tab"]')) {
      const txt = await t.evaluate((e: Element) => e.textContent ?? '')
      if (/usuario/i.test(txt)) { await t.click(); break }
    }
    await esperar(4000)

    await pAdmin.evaluate((nombre: string) => {
      const fila = Array.from(document.querySelectorAll('tbody tr'))
        .find((f) => (f.textContent ?? '').includes(nombre))
      const b = fila?.querySelectorAll('button')[0]
      ;(b as HTMLButtonElement)?.click()
    }, 'ZZ Usuario a editar')
    await esperar(3000)

    const cambio = await pAdmin.evaluate(() => {
      const lbl = Array.from(document.querySelectorAll('label'))
        .find((l) => /^rol/i.test((l.textContent ?? '').trim()))
      const sel = lbl?.parentElement?.querySelector('select') as HTMLSelectElement | null
      if (!sel) return null
      const otra = Array.from(sel.options).find((o) => o.value !== sel.value)!
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
      setter.call(sel, otra.value)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return otra.value
    })
    await esperar(1000)
    await pAdmin.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => /^(guardar|actualizar)/i.test((x.textContent ?? '').trim()))
      ;(b as HTMLButtonElement)?.click()
    })
    await esperar(7000)

    const { data: tras } = await (admin as any).from('profiles')
      .select('role').eq('id', idBlanco).maybeSingle()
    check('Cambiar el rol se guarda', (tras as any)?.role === cambio,
      `pedido ${cambio}, quedó ${(tras as any)?.role}`)
    check('Sin peticiones fallidas al guardar', fallidas.length === 0,
      fallidas.slice(0, 2).join(' | '))

    // ── El IGV ───────────────────────────────────────────────────────────
    await irASeries(pAdmin)
    const igvAdmin = await pAdmin.evaluate(() => {
      const t = document.body.innerText
      const lbl = Array.from(document.querySelectorAll('label'))
        .find((l) => /tasa vigente/i.test(l.textContent ?? ''))
      const inp = lbl?.parentElement?.querySelector('input') as HTMLInputElement | null
      return { hayTarjeta: /Impuesto General a las Ventas/i.test(t), valor: inp?.value ?? null }
    })
    check('El administrador ve la tarjeta del IGV', igvAdmin.hayTarjeta)
    check('Muestra la tasa guardada', igvAdmin.valor === '18', igvAdmin.valor ?? 'sin campo')

    // ══ 2. El vendedor NO debe verla ═════════════════════════════════════
    const pVend = await entrar(VEND)
    check('El vendedor entra', !pVend.url().includes('/login'))
    await irASeries(pVend)
    const igvVend = await pVend.evaluate(() =>
      /Impuesto General a las Ventas/i.test(document.body.innerText))
    check('Un vendedor NO ve la tarjeta del IGV', !igvVend)

    const { data: sigue } = await (admin as any).from('configuracion')
      .select('valor').eq('clave', 'igv_porcentaje').maybeSingle()
    check('La tasa guardada sigue en 18', (sigue as any)?.valor === '18',
      (sigue as any)?.valor ?? '?')
  } finally {
    if (browser) await browser.close()
    for (const id of creados) {
      await admin.from('profiles').delete().eq('id', id)
      await admin.auth.admin.deleteUser(id)
    }
    console.log('\n  Usuarios temporales eliminados.')
  }

  const bien = resultados.filter(([, ok]) => ok).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
