/**
 * Que el sistema en blanco siga andando.
 *
 * Al limpiar el movimiento para empezar a usarlo, cada pantalla pasa a mirar
 * tablas vacías. Un promedio sobre cero filas o un `datos[0].algo` sin datos
 * rompen justo ahí, y no se ve hasta que alguien entra. Esto entra a todas.
 *
 * Cuenta como falla: la pantalla de error, un error de JavaScript sin atrapar,
 * que mande de vuelta al login, o que quede casi vacía.
 *
 *   BASE=https://agrocar-erp-full.vercel.app npx tsx scripts/recorrer-sistema-en-blanco.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3014'

const PANTALLAS = [
  '/dashboard', '/pedidos', '/despacho', '/despacho/historial', '/facturacion',
  '/cobranzas', '/caja', '/caja-chica', '/gps', '/solicitudes-cliente',
  '/almacen', '/almacen/ajustes', '/almacen/compras', '/almacen/lotes',
  '/almacen/movimientos-dia', '/almacen/notas-credito', '/almacen/valorizado',
  '/maestros/clientes', '/maestros/productos', '/maestros/familias',
  '/maestros/zonas', '/maestros/vehiculos', '/maestros/conductores',
  '/maestros/proveedores', '/maestros/tipos-cliente',
  '/vendedores', '/vendedores/cuotas', '/vendedores/cuotas/productos',
  '/reportes', '/reportes/alcance-objetivos', '/reportes/catalogo', '/reportes/cobros',
  '/reportes/cuentas-por-cobrar', '/reportes/cumplimiento-cuotas', '/reportes/equipo',
  '/reportes/rendicion-diaria', '/reportes/ventas-productos',
  '/configuracion', '/configuracion/series', '/configuracion/comisiones',
  '/configuracion/impresion', '/configuracion/tipo-cambio',
  '/contabilidad', '/contabilidad/diario', '/contabilidad/mayor',
  '/contabilidad/estado-resultados', '/contabilidad/balance', '/contabilidad/periodos',
  '/planillas', '/planillas/trabajadores', '/planillas/conceptos',
  '/pwa/pedidos', '/pwa/clientes', '/pwa/cobros', '/pwa/mis-cobranzas',
  '/pwa/mis-cuotas', '/pwa/mi-reporte', '/pwa/mi-zona', '/pwa/reparto',
  '/pwa/deposito', '/pwa/checkin', '/pwa/cuenta',
]

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
const ADMIN = { correo: `zz.blanco.${sello}@agrocar.pe`, clave: `Zb-${sello}-t!` }
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log(`\nEL SISTEMA EN BLANCO, PANTALLA POR PANTALLA — ${BASE}\n`)

  const { data: creado, error } = await admin.auth.admin.createUser({
    email: ADMIN.correo, password: ADMIN.clave, email_confirm: true,
  })
  if (error) throw error
  const userId = creado.user!.id
  await admin.from('profiles').upsert({
    id: userId, email: ADMIN.correo, full_name: 'ZZ Recorrido de prueba',
    role: 'administrador', activo: true,
  } as never)

  const fallas: string[] = []
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1400, height: 1000 })
    await page.emulateTimezone('America/Lima')
    // El service worker recarga la página al tomar el control y corta el
    // login a la mitad. Acá se prueban las pantallas, no el cache.
    await page.setBypassServiceWorker(true)

    let erroresJs: string[] = []
    page.on('pageerror', (e) => erroresJs.push(String((e as Error).message ?? e).slice(0, 120)))

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 })
    // Si se escribe antes de que React tome la pantalla, la hidratación borra
    // lo escrito. Se reintenta hasta que los dos campos queden con su valor.
    for (let i = 0; i < 5; i++) {
      await esperar(3000)
      await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.type('input[type="email"]', ADMIN.correo)
      await page.type('input[type="password"]', ADMIN.clave)
      await esperar(800)
      const ok = await page.evaluate((c) =>
        (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === c,
      ADMIN.correo)
      if (ok) break
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
    // En producción el service worker toma el control al entrar y recarga la
    // página una vez: se espera a que termine en vez de un tiempo fijo.
    for (let i = 0; i < 20 && page.url().includes('/login'); i++) await esperar(2000)
    await esperar(4000)
    if (page.url().includes('/login')) {
      const t = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
      await page.screenshot({ path: '.sunat/login-fallido.png' }).catch(() => {})
      throw new Error(`No pudo entrar al sistema: ${t.replace(/\s+/g, ' ').slice(0, 300)}`)
    }

    for (const ruta of PANTALLAS) {
      erroresJs = []
      await page.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle2', timeout: 90000 })
        .catch(() => {})
      await esperar(2500)
      const texto = await page.evaluate(() => document.body?.innerText ?? '')
      const problemas: string[] = []
      if (page.url().includes('/login')) problemas.push('mandó al login')
      if (/Algo salió mal|Application error|Ocurrió un error|Unhandled Runtime Error/i.test(texto)) {
        problemas.push('pantalla de error')
      }
      if (texto.trim().length < 60) problemas.push(`casi vacía (${texto.trim().length} car.)`)
      if (erroresJs.length) problemas.push(`JS: ${erroresJs[0]}`)

      if (problemas.length) fallas.push(`${ruta}: ${problemas.join(' · ')}`)
      console.log(`  ${problemas.length ? 'MAL ' : 'OK  '} ${ruta}${problemas.length ? `  — ${problemas.join(' · ')}` : ''}`)
    }
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
    console.log('\n  Usuario temporal eliminado.')
  }

  console.log(`\n  ${PANTALLAS.length - fallas.length} de ${PANTALLAS.length} pantallas cargaron bien.\n`)
  if (fallas.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.stack, '\n'); process.exit(1) })
