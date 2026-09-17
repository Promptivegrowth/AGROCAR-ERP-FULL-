/**
 * La hoja de reparto tiene que imprimir el repartidor asignado.
 *
 * Daniel lo pidió: "por favor agregar en el reporte de pedido que imprima el
 * nombre del repartidor asignado". Lo venían escribiendo a mano en cada hoja,
 * arriba y al lado de la firma.
 *
 * El dato ya existía —se elige al armar el despacho y se guarda en
 * despachos.repartidor_id— pero la hoja no lo consultaba.
 *
 * Se abren dos hojas de verdad: una de un despacho con repartidor asignado y
 * otra de uno sin asignar, porque las dos tienen que salir bien.
 *
 *   BASE=http://localhost:3011 npx tsx scripts/verificar-repartidor-en-hoja.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3011'

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

const CORREO = `verificacion.repartidor.${Date.now()}@agrocar.pe`
const CLAVE = `Vh-${Date.now()}-tmp!`
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log('\nEL REPARTIDOR EN LA HOJA DE REPARTO\n')

  // Los dos casos que tienen que andar.
  const { data: conRep } = await (admin as any).from('despachos')
    .select('id, numero, repartidor:profiles!despachos_repartidor_id_fkey(full_name)')
    .not('repartidor_id', 'is', null)
    .order('fecha_despacho', { ascending: false }).limit(1).maybeSingle()
  const { data: sinRep } = await (admin as any).from('despachos')
    .select('id, numero')
    .is('repartidor_id', null)
    .order('fecha_despacho', { ascending: false }).limit(1).maybeSingle()

  const conNombre = (conRep as any)?.repartidor?.full_name as string | undefined
  check('Hay un despacho CON repartidor para probar', !!conNombre,
    `${(conRep as any)?.numero} · ${conNombre ?? ''}`)
  check('Hay un despacho SIN repartidor para probar', !!sinRep,
    (sinRep as any)?.numero ?? '')

  const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
    email: CORREO, password: CLAVE, email_confirm: true,
  })
  if (errCrear) throw errCrear
  const userId = creado.user!.id
  await admin.from('profiles').upsert({
    id: userId, email: CORREO, full_name: 'Verificación repartidor',
    role: 'administrador', activo: true,
  } as never)

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1240, height: 1600 })
    // En hora de Tacna: con el navegador en UTC el desfase de dia no se ve.
    await page.emulateTimezone('America/Lima')

    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(`[pageerror] ${(e as Error).message}`))
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()) })

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.type('input[type="email"]', CORREO)
    await page.type('input[type="password"]', CLAVE)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
    await esperar(6000)
    check('Entra al sistema', !page.url().includes('/login'), page.url().replace(BASE, ''))

    // ── La hoja del despacho CON repartidor ───────────────────────────────
    await page.goto(`${BASE}/hoja-ruta/${(conRep as any).id}/simple`,
      { waitUntil: 'networkidle2', timeout: 90000 })
    await esperar(5000)

    const texto = await page.evaluate(() => document.body.innerText)
    check('La hoja carga', /REPARTO\/ENTREGA DE PEDIDOS/i.test(texto), `${texto.length} caracteres`)
    check('Dice "Repartidor:" en la cabecera', /Repartidor:/.test(texto))
    check('Imprime el nombre del repartidor asignado',
      !!conNombre && texto.includes(conNombre), conNombre ?? '')

    // Tiene que aparecer dos veces: en la cabecera y sobre la firma.
    const veces = conNombre ? texto.split(conNombre).length - 1 : 0
    check('Aparece también sobre la línea de firma', veces >= 2, `${veces} veces en la hoja`)

    // Las tres firmas a la misma altura, aunque una lleve el nombre encima.
    const firmas = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('p'))
        .filter((p) => /^Firma del |^Recib/i.test((p.textContent ?? '').trim()))
      return ps.map((p) => ({
        texto: (p.textContent ?? '').trim(),
        y: Math.round(p.getBoundingClientRect().top),
      }))
    })
    const alturas = Array.from(new Set(firmas.map((f) => f.y)))
    check('Las tres firmas quedan alineadas', firmas.length === 3 && alturas.length === 1,
      firmas.map((f) => `${f.texto}@${f.y}`).join(' · '))

    await page.screenshot({ path: '.sunat/hoja-repartidor.png', fullPage: false })

    // ── La hoja del despacho SIN repartidor ───────────────────────────────
    await page.goto(`${BASE}/hoja-ruta/${(sinRep as any).id}/simple`,
      { waitUntil: 'networkidle2', timeout: 90000 })
    await esperar(5000)
    const textoSin = await page.evaluate(() => document.body.innerText)

    check('La hoja sin repartidor también carga',
      /REPARTO\/ENTREGA DE PEDIDOS/i.test(textoSin), `${textoSin.length} caracteres`)
    check('Deja la raya para escribirlo a mano', /Repartidor:\s*_{4,}/.test(textoSin))
    check('No inventa un nombre', !/Repartidor:\s*[A-ZÁÉÍÓÚÑ]{3,}/.test(textoSin))

    // ── La fecha del encabezado ───────────────────────────────────────────
    // Imprimia el dia anterior: `new Date('2026-09-16')` es medianoche UTC y en
    // Lima cae el 15. Se comprueba con el navegador puesto en hora de Tacna.
    for (const caso of [conRep, sinRep] as any[]) {
      const { data: d } = await (admin as any).from('despachos')
        .select('numero, fecha_despacho').eq('id', caso.id).maybeSingle()
      const esperada = String((d as any).fecha_despacho)
      const [a, m, dia] = esperada.split('-')
      const quiero = `${dia}/${m}/${a}`

      await page.goto(`${BASE}/hoja-ruta/${caso.id}/simple`,
        { waitUntil: 'networkidle2', timeout: 90000 })
      await esperar(4000)
      const t = await page.evaluate(() => document.body.innerText)
      const impresa = (t.match(/(\d{2}\/\d{2}\/\d{4})/) ?? [])[1] ?? '?'
      check(`${(d as any).numero}: imprime la fecha del despacho`,
        impresa === quiero, `esperada ${quiero}, imprime ${impresa}`)
    }

    const graves = errores.filter((e) =>
      !e.includes('favicon') && !e.includes('manifest') && !e.includes('sw.js')
      && !e.toLowerCase().includes('download the react devtools'))
    check('Sin errores de JavaScript', graves.length === 0,
      graves.slice(0, 2).join(' | ').slice(0, 130))
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
