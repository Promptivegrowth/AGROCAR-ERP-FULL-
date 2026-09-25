/**
 * Los nueve reportes de Excel, después de tocar la ayuda compartida.
 *
 * `seccionTabla` la usan nueve rutas, y ocho de ellas la llaman más de una vez
 * por hoja —que es justo lo que se arregló: los anchos se pisaban entre
 * tablas—. Un cambio ahí las toca a todas, así que se generan todas y se
 * revisa que sigan saliendo bien.
 *
 *   BASE=http://localhost:3016 npx tsx scripts/probar-todos-los-excel.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3016'

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
const USUARIO = { correo: `zz.todos.${sello}@agrocar.pe`, clave: `Zt-${sello}-t!` }
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log('\nLOS NUEVE REPORTES DE EXCEL\n')

  // Los identificadores que hacen falta para las rutas con parámetro.
  const uno = async (tabla: string, filtro?: (q: any) => any) => {
    let q = (admin as any).from(tabla).select('id').limit(1)
    if (filtro) q = filtro(q)
    const { data } = await q.maybeSingle()
    return (data as { id?: string } | null)?.id ?? null
  }
  const idCliente = await uno('clientes')
  const idPersona = await uno('profiles')
  const idSesion = await uno('caja_sesiones')

  const rutas: [string, string][] = [
    ['inventario valorizado', '/api/almacen/valorizado/excel'],
    ['catálogo', '/api/reportes/catalogo/excel'],
    ['ventas por producto', '/api/reportes/ventas-productos/excel'],
    ['rendición diaria', '/api/reportes/rendicion-diaria/excel'],
    ['cliente', `/api/reportes/cliente/${idCliente}/excel`],
    ['cobranzas por cliente', `/api/reportes/cobranzas-cliente/${idCliente}/excel`],
    ['cobranzas por vendedor', `/api/reportes/cobranzas-vendedor/${idPersona}/excel`],
    ['persona', `/api/reportes/persona/${idPersona}/excel`],
    ['cierre de caja', `/api/caja/cierre/${idSesion}/excel`],
  ]

  const { data: creado, error } = await admin.auth.admin.createUser({
    email: USUARIO.correo, password: USUARIO.clave, email_confirm: true,
  })
  if (error) throw error
  const userId = creado.user!.id
  await admin.from('profiles').upsert({
    id: userId, email: USUARIO.correo, full_name: 'ZZ Todos',
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

    fs.mkdirSync('.sunat/excel', { recursive: true })

    for (const [nombre, ruta] of rutas) {
      if (ruta.includes('/null/')) { check(`${nombre}: hay datos para probarlo`, false, ruta); continue }

      const r = await page.evaluate(async (u) => {
        const res = await fetch(u)
        if (!res.ok) return { estado: res.status, b64: null as string | null }
        const bytes = new Uint8Array(await res.arrayBuffer())
        let s = ''
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
        return { estado: res.status, b64: btoa(s) }
      }, `${BASE}${ruta}`)

      if (!r.b64) { check(`${nombre}: genera`, false, `HTTP ${r.estado}`); continue }

      const archivo = `.sunat/excel/${nombre.replace(/\s+/g, '-')}.xlsx`
      fs.writeFileSync(archivo, Buffer.from(r.b64, 'base64'))

      // Que abra y que nada quede cortado por ancho.
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.readFile(archivo)
      const sh = wb.worksheets[0]

      let cortados = 0
      sh.eachRow((fila, nFila) => {
        fila.eachCell((celda, nCol) => {
          if (typeof celda.value !== 'string') return
          const texto = celda.value.trim()
          if (!texto) return
          if (sh.getColumn(nCol).alignment?.wrapText) return
          let ancho = 0
          const maestro = (sh as any).getCell(nFila, nCol).master
          const desde = maestro && maestro.col ? maestro.col : nCol
          let hasta = desde
          while (hasta < sh.columnCount
            && (sh as any).getCell(nFila, hasta + 1).master?.col === desde) hasta++
          for (let c = desde; c <= hasta; c++) ancho += sh.getColumn(c).width ?? 10
          if (texto.length > ancho + 1) cortados++
        })
      })

      check(`${nombre}`, cortados === 0,
        `${sh.rowCount} filas · ${sh.columnCount} columnas`
        + (cortados ? ` · ${cortados} textos cortados` : ''))
    }
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
