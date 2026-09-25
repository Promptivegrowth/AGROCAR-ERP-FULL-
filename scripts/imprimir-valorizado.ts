/**
 * Imprimir a PDF el inventario valorizado, como lo haría Daniel.
 *
 * Daniel: "revisar el reporte de inventario valorizado para impresión en PDF y
 * Excel, no está bien tabulado".
 *
 * Esto abre la pantalla con un navegador de verdad y la manda a PDF con el
 * mismo camino que usa el botón Imprimir. Después cuenta lo que quedó en el
 * papel: cuántas filas del detalle salieron, cuántas hay en pantalla, y si la
 * cabecera de la tabla se repite en cada hoja.
 *
 *   BASE=http://localhost:3015 npx tsx scripts/imprimir-valorizado.ts [salida.pdf]
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3015'
const SALIDA = process.argv[2] ?? '.sunat/valorizado.pdf'

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
const USUARIO = { correo: `zz.inv.${sello}@agrocar.pe`, clave: `Zi-${sello}-t!` }
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log('\nINVENTARIO VALORIZADO — IMPRESIÓN\n')

  const { data: creado, error } = await admin.auth.admin.createUser({
    email: USUARIO.correo, password: USUARIO.clave, email_confirm: true,
  })
  if (error) throw error
  const userId = creado.user!.id
  await admin.from('profiles').upsert({
    id: userId, email: USUARIO.correo, full_name: 'ZZ Inventario',
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
    await page.emulateTimezone('America/Lima')

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.type('input[type="email"]', USUARIO.correo)
    await page.type('input[type="password"]', USUARIO.clave)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
    await esperar(6000)

    await page.goto(`${BASE}/almacen/valorizado`, { waitUntil: 'networkidle2', timeout: 90000 })
    await esperar(9000)

    // Lo que hay en pantalla.
    const enPantalla = await page.evaluate(() => {
      const tablas = Array.from(document.querySelectorAll('table'))
      return tablas.map((t) => ({
        columnas: t.querySelectorAll('thead th').length,
        filas: t.querySelectorAll('tbody tr').length,
      }))
    })
    console.log('  EN PANTALLA:')
    enPantalla.forEach((t, i) =>
      console.log(`    tabla ${i + 1}: ${t.columnas} columnas · ${t.filas} filas`))

    // Lo que se recorta al imprimir: cajas con alto máximo y scroll.
    const recortes = await page.evaluate(() => {
      const malos: string[] = []
      document.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el)
        const scrolleaY = cs.overflowY === 'auto' || cs.overflowY === 'scroll'
        if (scrolleaY && el.scrollHeight > el.clientHeight + 4) {
          malos.push(`${el.className}`.slice(0, 90)
            + ` (se ve ${el.clientHeight}px de ${el.scrollHeight}px)`)
        }
      })
      return malos
    })
    console.log(`\n  CAJAS QUE RECORTAN AL IMPRIMIR: ${recortes.length}`)
    recortes.forEach((r) => console.log(`    · ${r}`))

    // El PDF, con el mismo camino que el botón Imprimir.
    fs.mkdirSync(path.dirname(SALIDA), { recursive: true })
    await page.pdf({
      path: SALIDA, format: 'A4', landscape: true, printBackground: true,
      margin: { top: '10mm', right: '8mm', bottom: '10mm', left: '8mm' },
    })

    // Lo que efectivamente quedó en el papel.
    await page.emulateMediaType('print')
    await esperar(1500)
    const enPapel = await page.evaluate(() => {
      // Sin funciones con nombre acá: tsx las compila con un ayudante que no
      // existe dentro del navegador.
      const tablas = Array.from(document.querySelectorAll('table'))
      return {
        tablas: tablas.map((t) => ({
          columnas: t.querySelectorAll('thead th').length,
          filas: Array.from(t.querySelectorAll('tbody tr'))
            .filter((tr) => tr.getBoundingClientRect().height > 0).length,
          cabeceraSeRepite: getComputedStyle(t.querySelector('thead')!).display === 'table-header-group',
        })),
        recortes: Array.from(document.querySelectorAll('*')).filter((el) => {
          const cs = getComputedStyle(el)
          return (cs.overflowY === 'auto' || cs.overflowY === 'scroll')
            && el.scrollHeight > el.clientHeight + 4
        }).length,
      }
    })
    console.log(`\n  EN EL PAPEL (media print):`)
    enPapel.tablas.forEach((t, i) =>
      console.log(`    tabla ${i + 1}: ${t.columnas} columnas · ${t.filas} filas`
        + ` · cabecera se repite: ${t.cabeceraSeRepite ? 'sí' : 'no'}`))
    console.log(`    cajas que siguen recortando: ${enPapel.recortes}`)

    // Una foto de como queda el papel, para mirarla.
    await page.setViewport({ width: 1123, height: 794 })
    await esperar(1200)
    await page.screenshot({ path: SALIDA.replace('.pdf', '.png'), fullPage: true })

    const kb = Math.round(fs.statSync(SALIDA).size / 1024)
    console.log(`\n  PDF: ${SALIDA} (${kb} KB)`)
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
    console.log('\n  Usuario temporal eliminado.\n')
  }
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
