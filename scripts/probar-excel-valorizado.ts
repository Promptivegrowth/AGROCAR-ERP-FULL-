/**
 * Bajar el Excel del inventario valorizado y mirarle las tripas.
 *
 * Daniel: "revisar el reporte de inventario valorizado para impresión en PDF y
 * Excel, no está bien tabulado".
 *
 * En Excel el ancho es de la COLUMNA, no de la tabla, y esta hoja lleva tres
 * tablas de 2, 5 y 10 columnas. Cada una pisaba los anchos de la anterior, así
 * que mandaba la última y las etiquetas largas de arriba quedaban cortadas.
 *
 * Esto genera el archivo de verdad y comprueba tres cosas: que ningún texto sea
 * más largo que su columna, que los porcentajes sean números y no texto, y que
 * las celdas sin dato estén vacías en vez de llevar un guion.
 *
 *   BASE=http://localhost:3015 npx tsx scripts/probar-excel-valorizado.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3015'
const SALIDA = '.sunat/valorizado.xlsx'

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
const USUARIO = { correo: `zz.xls.${sello}@agrocar.pe`, clave: `Zx-${sello}-t!` }
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log('\nEXCEL DEL INVENTARIO VALORIZADO\n')

  const { data: creado, error } = await admin.auth.admin.createUser({
    email: USUARIO.correo, password: USUARIO.clave, email_confirm: true,
  })
  if (error) throw error
  const userId = creado.user!.id
  await admin.from('profiles').upsert({
    id: userId, email: USUARIO.correo, full_name: 'ZZ Excel',
    role: 'administrador', activo: true,
  } as never)

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.type('input[type="email"]', USUARIO.correo)
    await page.type('input[type="password"]', USUARIO.clave)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
    await esperar(6000)

    // Se baja como lo baja Daniel: desde la sesión del navegador.
    const b64 = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/almacen/valorizado/excel`)
      if (!r.ok) return null
      const buf = await r.arrayBuffer()
      let s = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
      return btoa(s)
    }, BASE)

    check('El Excel se descarga', !!b64)
    if (!b64) throw new Error('no se pudo descargar')

    fs.mkdirSync(path.dirname(SALIDA), { recursive: true })
    fs.writeFileSync(SALIDA, Buffer.from(b64, 'base64'))
    console.log(`  archivo: ${SALIDA} (${Math.round(fs.statSync(SALIDA).size / 1024)} KB)\n`)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(SALIDA)
    const sh = wb.worksheets[0]

    // ── Nada más ancho que su columna ─────────────────────────────────────
    const cortados: string[] = []
    sh.eachRow((fila, nFila) => {
      fila.eachCell((celda, nCol) => {
        if (typeof celda.value !== 'string') return
        const texto = celda.value.trim()
        if (!texto) return
        // Una celda fusionada dispone del ancho de todas las que abarca.
        let ancho = 0
        const rango = (sh as any).getCell(nFila, nCol).master
        const desde = rango && rango.col ? rango.col : nCol
        let hasta = desde
        while (hasta < sh.columnCount
          && (sh as any).getCell(nFila, hasta + 1).master?.col === desde) hasta++
        for (let c = desde; c <= hasta; c++) ancho += sh.getColumn(c).width ?? 10

        // Una columna con ajuste de texto reparte el contenido en varias
        // lineas: ahi no hay nada cortado por ancho.
        if (sh.getColumn(nCol).alignment?.wrapText) return

        // Se compara contra el ancho real; un poco de holgura por la fuente.
        if (texto.length > ancho + 1) {
          cortados.push(`fila ${nFila} col ${nCol}: "${texto.slice(0, 40)}" (${texto.length} > ${ancho})`)
        }
      })
    })
    check('Ningún texto queda más ancho que su columna', cortados.length === 0,
      cortados.slice(0, 3).join(' · ') || `${sh.columnCount} columnas revisadas`)

    // ── Los porcentajes son números ───────────────────────────────────────
    let pctTexto = 0
    let pctNumero = 0
    sh.eachRow((fila) => {
      fila.eachCell((celda) => {
        const v = celda.value
        if (typeof v === 'string' && /^-?\d+([.,]\d+)?%$/.test(v.trim())) pctTexto++
        if (typeof v === 'number' && String(celda.numFmt ?? '').includes('%')) pctNumero++
      })
    })
    check('Los porcentajes van como número, no como texto',
      pctTexto === 0 && pctNumero > 0, `${pctNumero} numéricos, ${pctTexto} de texto`)

    // ── Sin guiones donde debería no haber nada ───────────────────────────
    let guiones = 0
    sh.eachRow((fila) => {
      fila.eachCell((celda) => { if (celda.value === '—') guiones++ })
    })
    check('Las celdas sin dato quedan vacías, no con un guion', guiones === 0,
      `${guiones} guiones`)

    // ── Que las tres tablas estén ─────────────────────────────────────────
    const textos: string[] = []
    sh.eachRow((fila) => fila.eachCell((c) => {
      if (typeof c.value === 'string') textos.push(c.value)
    }))
    for (const titulo of ['Totales', 'Resumen por familia', 'Detalle por producto']) {
      check(`Está la sección "${titulo}"`,
        textos.some((t) => t.startsWith(titulo)), '')
    }

    const anchos = Array.from({ length: sh.columnCount }, (_, i) =>
      Math.round(sh.getColumn(i + 1).width ?? 0))
    console.log(`\n  anchos de columna: ${anchos.join(' · ')}`)
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
