/**
 * Reproducir en la pantalla el error al cambiar el rol.
 *
 * La base acepta el cambio para los 15 usuarios reales, así que el problema
 * está del lado del navegador. Esto abre Configuración de verdad, edita un
 * usuario de prueba, le cambia el rol, guarda, y anota lo que sale: el aviso
 * en pantalla, los errores de consola y las peticiones que fallaron.
 *
 * El usuario que edita y el editado son temporales y se borran al terminar.
 *
 *   BASE=http://localhost:3012 npx tsx scripts/reproducir-error-rol-en-vivo.ts
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
const ADMIN = { correo: `zz.admin.${sello}@agrocar.pe`, clave: `Za-${sello}-tmp!` }
const BLANCO = { correo: `zz.blanco.${sello}@agrocar.pe`, clave: `Zb-${sello}-tmp!` }
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log('\nCAMBIAR EL ROL, EN LA PANTALLA\n')

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
    const idBlanco = await crear(BLANCO, 'vendedor', 'ZZ Usuario de prueba')

    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 1000 })

    const consola: string[] = []
    const fallidas: string[] = []
    page.on('pageerror', (e) => consola.push(`[pageerror] ${(e as Error).message}`))
    page.on('console', (m) => { if (m.type() === 'error') consola.push(m.text().slice(0, 200)) })
    page.on('response', async (r) => {
      if (r.status() >= 400 && !r.url().includes('favicon')) {
        let cuerpo = ''
        try { cuerpo = (await r.text()).slice(0, 220) } catch { /* sin cuerpo */ }
        fallidas.push(`HTTP ${r.status()} ${r.url().replace(BASE, '').slice(0, 90)}  ${cuerpo}`)
      }
    })

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.type('input[type="email"]', ADMIN.correo)
    await page.type('input[type="password"]', ADMIN.clave)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
    await esperar(6000)
    console.log(`  entró a: ${page.url().replace(BASE, '')}`)

    await page.goto(`${BASE}/configuracion`, { waitUntil: 'networkidle2', timeout: 90000 })
    await esperar(7000)

    // La pestaña de usuarios (Radix escucha pointerdown: clic de verdad).
    for (const t of await page.$$('[role="tab"]')) {
      const txt = await t.evaluate((e) => e.textContent ?? '')
      if (/usuario/i.test(txt)) { await t.click(); break }
    }
    await esperar(4000)

    // Abrir la edición del usuario de prueba: el botón de su fila.
    const abrio = await page.evaluate((nombre) => {
      const filas = Array.from(document.querySelectorAll('tbody tr'))
      const fila = filas.find((f) => (f.textContent ?? '').includes(nombre))
      if (!fila) return 'no se encontró la fila'
      const botones = Array.from(fila.querySelectorAll('button'))
      const editar = botones.find((b) => /editar/i.test(b.textContent ?? '' + (b.getAttribute('title') ?? '')))
        ?? botones[0]
      if (!editar) return 'la fila no tiene botones'
      ;(editar as HTMLButtonElement).click()
      return 'ok'
    }, 'ZZ Usuario de prueba')
    console.log(`  abrir edición: ${abrio}`)
    await esperar(3000)

    // Cambiar el rol en el select del diálogo.
    const cambio = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'))
      const lbl = labels.find((l) => /^rol/i.test((l.textContent ?? '').trim()))
      const sel = lbl?.parentElement?.querySelector('select') as HTMLSelectElement | null
      if (!sel) return 'no está el select de rol'
      const antes = sel.value
      const otra = Array.from(sel.options).find((o) => o.value !== antes)
      if (!otra) return 'el select no tiene otras opciones'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
      setter.call(sel, otra.value)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return `${antes} → ${otra.value}`
    })
    console.log(`  rol: ${cambio}`)
    await esperar(1500)

    // Guardar.
    const guardo = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => /^(guardar|actualizar)/i.test((x.textContent ?? '').trim()))
      if (!b) return 'no está el botón de guardar'
      ;(b as HTMLButtonElement).click()
      return 'apretado'
    })
    console.log(`  guardar: ${guardo}`)
    await esperar(7000)

    // Lo que salió en pantalla.
    const avisos = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-sonner-toast], [role="status"], [role="alert"]'))
        .map((t) => (t.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))
    console.log(`\n  AVISOS EN PANTALLA:`)
    if (avisos.length === 0) console.log('    (ninguno)')
    avisos.forEach((a) => console.log(`    · ${a.slice(0, 200)}`))

    console.log(`\n  PETICIONES QUE FALLARON:`)
    if (fallidas.length === 0) console.log('    (ninguna)')
    fallidas.forEach((f) => console.log(`    · ${f}`))

    const graves = consola.filter((e) =>
      !e.includes('favicon') && !e.includes('manifest') && !e.includes('sw.js')
      && !e.toLowerCase().includes('download the react devtools'))
    console.log(`\n  ERRORES DE CONSOLA:`)
    if (graves.length === 0) console.log('    (ninguno)')
    graves.slice(0, 6).forEach((e) => console.log(`    · ${e}`))

    const { data: fin } = await (admin as any).from('profiles')
      .select('role').eq('id', idBlanco).maybeSingle()
    console.log(`\n  EL ROL EN LA BASE QUEDÓ EN: ${(fin as any)?.role}`)
  } finally {
    if (browser) await browser.close()
    for (const id of creados) {
      await admin.from('profiles').delete().eq('id', id)
      await admin.auth.admin.deleteUser(id)
    }
    console.log('\n  Usuarios temporales eliminados.')
  }
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
