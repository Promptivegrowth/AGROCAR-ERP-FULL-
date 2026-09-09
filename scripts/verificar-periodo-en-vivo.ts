/**
 * Abrir Facturación de verdad y comprobar que el periodo funciona.
 *
 * Que las consultas traigan lo correcto ya se probó aparte. Esto prueba lo
 * otro: que la persona pueda usarlo. Entra con un navegador, cambia de mes,
 * busca un comprobante viejo y mira que la pantalla responda.
 *
 * El usuario que usa se crea al empezar y se borra al terminar, pase lo que pase.
 *
 *   BASE=http://localhost:3008 npx tsx scripts/verificar-periodo-en-vivo.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3008'

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

const CORREO = `verificacion.periodo.${Date.now()}@agrocar.pe`
const CLAVE = `Vp-${Date.now()}-tmp!`
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log('\nFACTURACIÓN POR PERIODO, EN LA APLICACIÓN CORRIENDO\n')

  const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
    email: CORREO, password: CLAVE, email_confirm: true,
  })
  if (errCrear) throw errCrear
  const userId = creado.user!.id
  await admin.from('profiles').upsert({
    id: userId, email: CORREO, full_name: 'Verificación periodo',
    role: 'administrador', activo: true,
  } as never)

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 1000 })

    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`[pageerror] ${(e as Error).message}`))
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()) })

    // ── Entrar ────────────────────────────────────────────────────────────
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.type('input[type="email"]', CORREO)
    await page.type('input[type="password"]', CLAVE)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
    await esperar(6000)
    check('Entra al sistema', !page.url().includes('/login'), page.url().replace(BASE, ''))

    // ── Facturación → pestaña Emitidos ────────────────────────────────────
    await page.goto(`${BASE}/facturacion`, { waitUntil: 'networkidle2', timeout: 90000 })
    await esperar(6000)
    // Radix escucha pointerdown: hace falta un clic de verdad.
    for (const t of await page.$$('[role="tab"]')) {
      const txt = await t.evaluate((e) => e.textContent ?? '')
      if (/emitid/i.test(txt)) { await t.click(); break }
    }
    await esperar(6000)

    // ── El selector de periodo ────────────────────────────────────────────
    const selector = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'))
      const lbl = labels.find((l) => /periodo/i.test(l.textContent ?? ''))
      const sel = lbl?.parentElement?.querySelector('select') as HTMLSelectElement | null
      if (!sel) return null
      return {
        valor: sel.value,
        opciones: Array.from(sel.options).map((o) => ({ v: o.value, t: o.text })),
      }
    })

    check('Está el selector de Periodo', !!selector)
    if (!selector) throw new Error('sin selector de periodo no se puede seguir')

    check('Arranca en el mes actual', selector.valor === '2026-09', selector.valor)
    check('Lista los meses con datos, el más reciente primero',
      selector.opciones.length >= 2 && selector.opciones[0].v === '2026-09',
      selector.opciones.map((o) => o.t).join(' · '))

    const filasDe = async () => page.evaluate(() =>
      document.querySelectorAll('table tbody tr').length)
    // Solo la franja, no la pagina entera: si el selector agarra de mas, la
    // comprobacion pasa sin haber medido nada.
    const franja = async () => page.evaluate(() => {
      const el = document.querySelector('[data-franja]')
      if (!el) return ''
      return `[${el.getAttribute('data-franja')}] `
        + (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    })

    const filasSet = await filasDe()
    check('Setiembre trae sus comprobantes', filasSet > 0, `${filasSet} filas`)
    check('La franja dice qué se está mirando', /setiembre/i.test(await franja()), await franja())

    // ── Cambiar a agosto ──────────────────────────────────────────────────
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'))
      const lbl = labels.find((l) => /periodo/i.test(l.textContent ?? ''))
      const sel = lbl?.parentElement?.querySelector('select') as HTMLSelectElement
      sel.value = '2026-08'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await esperar(8000)

    const filasAgo = await filasDe()
    check('Al elegir agosto la tabla se vuelve a cargar',
      filasAgo > 0 && filasAgo !== filasSet, `agosto ${filasAgo} filas contra setiembre ${filasSet}`)
    check('La franja pasa a decir agosto', /agosto/i.test(await franja()), await franja())

    const soloAgosto = await page.evaluate(() =>
      Array.from(document.querySelectorAll('table tbody tr'))
        .map((tr) => tr.textContent ?? '')
        .filter((t) => /\d{2}\/\d{2}\/\d{4}/.test(t))
        .map((t) => (t.match(/(\d{2})\/(\d{2})\/(\d{4})/) ?? [])[2])
        .filter(Boolean))
    check('Todas las filas visibles son de agosto',
      soloAgosto.length > 0 && soloAgosto.every((m) => m === '08'),
      `${soloAgosto.length} fechas leídas, meses: ${Array.from(new Set(soloAgosto)).join(',')}`)

    // ── Buscar en todos los periodos ──────────────────────────────────────
    // Se vuelve a setiembre y se busca un comprobante de agosto: si la busqueda
    // solo mirara el periodo, no aparecería.
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'))
      const lbl = labels.find((l) => /periodo/i.test(l.textContent ?? ''))
      const sel = lbl?.parentElement?.querySelector('select') as HTMLSelectElement
      sel.value = '2026-09'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await esperar(7000)

    const buscado = 'B002-00000013'
    await page.evaluate((q) => {
      const inp = document.querySelector('input[placeholder*="Buscar por número"]') as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(inp, q)
      inp.dispatchEvent(new Event('input', { bubbles: true }))
    }, buscado)
    await esperar(2500)

    const sinResultadosEnElMes = await filasDe()
    check('Buscando un comprobante de agosto, en setiembre no aparece',
      sinResultadosEnElMes === 0, `${sinResultadosEnElMes} filas`)

    const hayBoton = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => /en todos los periodos/i.test(x.textContent ?? ''))
      if (b) (b as HTMLButtonElement).click()
      return !!b
    })
    check('Ofrece buscar en todos los periodos', hayBoton)
    await esperar(8000)

    const filasBusqueda = await filasDe()
    check('La búsqueda global lo encuentra', filasBusqueda > 0, `${filasBusqueda} filas`)
    check('La franja avisa que son resultados de todo el historial',
      /todo el historial/i.test(await franja()), await franja())

    const encontroElBuscado = await page.evaluate((q) =>
      Array.from(document.querySelectorAll('table tbody tr'))
        .some((tr) => (tr.textContent ?? '').includes(q)), buscado)
    check(`Aparece ${buscado}, que es de agosto`, encontroElBuscado)

    const hayVolver = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => /volver a/i.test(x.textContent ?? ''))
      if (b) (b as HTMLButtonElement).click()
      return !!b
    })
    check('Hay cómo volver al periodo', hayVolver)
    await esperar(7000)
    check('Al volver, se está mirando setiembre otra vez',
      /setiembre/i.test(await franja()), await franja())

    await page.screenshot({ path: '.sunat/facturacion-periodo.png', fullPage: false })

    const graves = errores.filter((e) =>
      !e.includes('favicon') && !e.includes('manifest') && !e.includes('sw.js')
      && !e.toLowerCase().includes('download the react devtools'))
    check('Sin errores de JavaScript en pantalla', graves.length === 0,
      graves.slice(0, 2).join(' | ').slice(0, 140))
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
    console.log('\n  Usuario temporal eliminado.')
  }

  const bien = resultados.filter(([, ok]) => ok).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
