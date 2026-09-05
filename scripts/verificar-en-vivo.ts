/**
 * Abrir la aplicación de verdad y comprobar que lo nuevo está y funciona.
 *
 * Compilar sin errores no prueba que la pantalla ande: prueba que el código es
 * válido. Esto entra con un navegador real, se autentica, carga las pantallas
 * y busca los elementos nuevos.
 *
 * El usuario que usa se crea al empezar y se borra al terminar, pase lo que
 * pase.
 *
 *   BASE=http://localhost:3001 npx tsx scripts/verificar-en-vivo.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3001'

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

const CORREO = `verificacion.temporal.${Date.now()}@agrocar.pe`
const CLAVE = `Vf-${Date.now()}-tmp!`

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log('\nVERIFICACIÓN EN LA APLICACIÓN CORRIENDO\n')

  // ── Usuario temporal, con rol administrador ──────────────────────────────
  const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
    email: CORREO, password: CLAVE, email_confirm: true,
  })
  if (errCrear) throw errCrear
  const userId = creado.user!.id
  await admin.from('profiles').upsert({
    id: userId, email: CORREO, full_name: 'Verificación temporal',
    role: 'administrador', activo: true,
  } as never)

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 1000 })

    const errores: string[] = []
    page.on('pageerror', (e) => { errores.push(`[pageerror] ${(e as Error).message}`) })
    page.on('console', (m) => {
      if (m.type() === 'error') {
        const donde = m.location()?.url ?? ''
        errores.push(`${m.text()} ${donde ? `(${donde.split('/').pop()})` : ''}`)
      }
    })
    page.on('requestfailed', (r) => {
      // Al cambiar de pantalla, el navegador aborta lo que quedo a medio pedir.
      // Eso no es una falla de la aplicacion.
      if (r.failure()?.errorText === 'net::ERR_ABORTED') return
      errores.push(`no cargo: ${r.url().split('/').pop()}`)
    })

    // ── Entrar ─────────────────────────────────────────────────────────────
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.type('input[type="email"]', CORREO)
    await page.type('input[type="password"]', CLAVE)
    // El boton de ingresar no lleva type="submit": se envia el formulario con
    // Enter, que es lo que hace cualquier persona igual.
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
    await new Promise((r) => setTimeout(r, 6000))
    if (page.url().includes('/login')) {
      const aviso = await page.evaluate(() => document.body.innerText.slice(0, 300))
      console.log(`       la pantalla dice: ${aviso.replace(/\s+/g, ' ').slice(0, 160)}`)
    }
    check('Entra al sistema', !page.url().includes('/login'), page.url().replace(BASE, ''))

    // ── Facturación: el botón nuevo y la etiqueta ──────────────────────────
    await page.goto(`${BASE}/facturacion`, { waitUntil: 'networkidle2', timeout: 90000 })
    await new Promise((r) => setTimeout(r, 6000))

    // La lista de comprobantes vive en su propia pestaña; hay que entrar ahi,
    // igual que haria cualquiera.
    // Un clic de verdad: Radix escucha pointerdown, asi que un .click()
    // simulado desde el propio documento no cambia de pestana.
    const pestanas = await page.$$('[role="tab"]')
    for (const t of pestanas) {
      const txt = await t.evaluate((e) => e.textContent ?? '')
      if (/emitid/i.test(txt)) { await t.click(); break }
    }
    await new Promise((r) => setTimeout(r, 5000))

    const texto = await page.evaluate(() => document.body.innerText)

    check('Carga Facturación sin caerse', texto.length > 500, `${texto.length} caracteres`)
    check('Está el botón "Fecha salida"', texto.includes('Fecha salida'))
    check('La columna SUNAT está', texto.includes('SUNAT'))
    check('Ya no muestra el nombre interno "nota_pedido_interna"',
      !texto.toLowerCase().includes('nota_pedido_interna'))

    const filas = await page.evaluate(() =>
      Array.from(document.querySelectorAll('table tbody tr')).length)
    check('La tabla de comprobantes trae filas', filas > 0, `${filas} filas`)

    const botones = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter((b) => b.textContent?.includes('Fecha salida')).length)
    check('El botón aparece en las filas', botones > 0, `${botones} botones`)

    await page.screenshot({ path: '.sunat/facturacion.png', fullPage: false })

    // ── PWA: el selector de comprobante ────────────────────────────────────
    await page.goto(`${BASE}/pwa/pedidos`, { waitUntil: 'networkidle2', timeout: 90000 })
    await new Promise((r) => setTimeout(r, 6000))
    const textoPwa = await page.evaluate(() => document.body.innerText)
    check('Carga la PWA de pedidos sin caerse', textoPwa.length > 200, `${textoPwa.length} caracteres`)
    await page.screenshot({ path: '.sunat/pwa.png', fullPage: false })

    // ── Movimientos del día ────────────────────────────────────────────────
    await page.goto(`${BASE}/almacen/movimientos-dia`, { waitUntil: 'networkidle2', timeout: 90000 })
    await new Promise((r) => setTimeout(r, 6000))
    const textoMov = await page.evaluate(() => document.body.innerText)
    check('Carga Movimientos del día', textoMov.length > 200)
    check('Dice que agrupa por despacho', textoMov.includes('despacho'))
    await page.screenshot({ path: '.sunat/movimientos.png', fullPage: false })

    // ── La correccion, ejercida como la ejerce la aplicacion ───────────────
    //
    // Hasta aca se probo que el boton esta. Falta lo importante: que al
    // apretarlo pase algo. Se llama a la misma funcion, con la sesion de este
    // usuario -no con la llave de servicio-, que es lo que prueba que los
    // permisos estan bien puestos.
    const sesion = await admin.auth.signInWithPassword({ email: CORREO, password: CLAVE })
    const token = sesion.data.session?.access_token
    check('El usuario obtiene sesion', !!token)

    if (token) {
      const url = env('NEXT_PUBLIC_SUPABASE_URL')
      const anon = env('NEXT_PUBLIC_SUPABASE_ANON_KEY')

      const { data: victima } = await admin.from('comprobantes')
        .select('id, serie, numero, fecha_despacho, fecha_emision')
        .eq('enviado_sunat', false).neq('estado', 'anulado')
        .not('fecha_despacho', 'is', null)
        .order('fecha_emision', { ascending: false }).limit(1).maybeSingle()
      const c = victima as { id: string; serie: string; numero: string; fecha_despacho: string } | null

      if (c) {
        const original = c.fecha_despacho
        const nueva = new Date(`${original}T12:00:00Z`)
        nueva.setUTCDate(nueva.getUTCDate() + 1)
        const nuevaTxt = nueva.toISOString().slice(0, 10)

        const llamar = async (fecha: string) => {
          const res = await fetch(`${url}/rest/v1/rpc/corregir_fecha_despacho_comprobante`, {
            method: 'POST',
            headers: {
              apikey: anon,
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              p_comprobante_id: c.id, p_fecha_despacho: fecha,
              p_motivo: 'Verificacion automatica del sistema',
            }),
          })
          return { estado: res.status, cuerpo: await res.json().catch(() => null) }
        }

        const ida = await llamar(nuevaTxt)
        check('La correccion funciona con la sesion del usuario', ida.estado === 200,
          `${c.serie}-${c.numero} ${original} -> ${nuevaTxt}`)

        const { data: rel } = await admin.from('comprobantes')
          .select('fecha_despacho, fecha_emision').eq('id', c.id).maybeSingle()
        const r2 = rel as { fecha_despacho: string; fecha_emision: string } | null
        check('Quedo guardada la fecha nueva', r2?.fecha_despacho === nuevaTxt, r2?.fecha_despacho ?? '')
        check('La fecha de emision no se movio', r2?.fecha_emision === (c as any).fecha_emision)

        // Y se deja como estaba: esto es una verificacion, no un cambio.
        const vuelta = await llamar(original)
        const { data: fin } = await admin.from('comprobantes')
          .select('fecha_despacho').eq('id', c.id).maybeSingle()
        check('Se puede volver atras y queda como estaba',
          vuelta.estado === 200 && (fin as { fecha_despacho: string } | null)?.fecha_despacho === original,
          original)
      }
    }

    const graves = errores.filter((e) =>
      !e.includes('favicon') && !e.includes('manifest') && !e.includes('sw.js')
      && !e.toLowerCase().includes('download the react devtools'))
    check('Sin errores de JavaScript en pantalla', graves.length === 0,
      graves.slice(0, 2).join(' | ').slice(0, 120))
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
