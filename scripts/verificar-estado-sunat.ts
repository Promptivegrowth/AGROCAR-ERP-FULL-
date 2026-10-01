/**
 * El apartado "Estado SUNAT", probado en vivo.
 *
 * Daniel pidió ver el estado de cada comprobante y poder verificar desde ahí
 * que llegó a SUNAT y fue aceptado. Esto entra a la pantalla con un
 * administrador temporal y comprueba que:
 *
 *   - lista todos los comprobantes del periodo, igual que la base
 *   - las tarjetas cuentan lo mismo que la tabla
 *   - "Verificar" le pregunta de verdad a SUNAT (servicio de consulta, que solo
 *     lee) y deja anotada la respuesta
 *   - el detalle abre con lo que anotó el ERP y lo que dice SUNAT
 *
 * La verificación de prueba se hace sobre UN comprobante y al final se borra
 * lo que dejó anotado, para que la pantalla quede como estaba.
 *
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-estado-sunat.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3014'

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
const ADMIN = { correo: `zz.sunat.${sello}@agrocar.pe`, clave: `Zs-${sello}-t!` }
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log(`\nEL APARTADO ESTADO SUNAT — ${BASE}\n`)

  // El mes más nuevo y cuántos tiene, según la base.
  const { data: ultimo } = await (admin as any).from('comprobantes').select('fecha_emision')
    .in('tipo', ['factura', 'boleta']).order('fecha_emision', { ascending: false }).limit(1).maybeSingle()
  if (!ultimo) throw new Error('No hay comprobantes')
  const mes = String(ultimo.fecha_emision).slice(0, 7)
  const [a, m] = mes.split('-').map(Number)
  const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
  const { count } = await (admin as any).from('comprobantes').select('id', { count: 'exact', head: true })
    .in('tipo', ['factura', 'boleta']).gte('fecha_emision', `${mes}-01`).lte('fecha_emision', fin)
  const { data: muestra } = await (admin as any).from('comprobantes')
    .select('id, serie, numero, sunat_verificado_at, sunat_verificacion')
    .eq('serie', 'F002').order('numero').limit(1).maybeSingle()
  console.log(`  la base dice: ${count} facturas y boletas en ${mes}; se verifica ${muestra.serie}-${muestra.numero}\n`)

  const { data: creado, error } = await admin.auth.admin.createUser({
    email: ADMIN.correo, password: ADMIN.clave, email_confirm: true,
  })
  if (error) throw error
  const userId = creado.user!.id
  await admin.from('profiles').upsert({
    id: userId, email: ADMIN.correo, full_name: 'ZZ Estado SUNAT', role: 'administrador', activo: true,
  } as never)

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 1100 })
    await page.emulateTimezone('America/Lima')
    await page.setBypassServiceWorker(true)
    const erroresJs: string[] = []
    page.on('pageerror', (e) => erroresJs.push(String((e as Error).message ?? e).slice(0, 140)))

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 180000 })
    for (let i = 0; i < 5; i++) {
      await esperar(3000)
      await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.type('input[type="email"]', ADMIN.correo)
      await page.type('input[type="password"]', ADMIN.clave)
      await esperar(800)
      const ok = await page.evaluate((c) =>
        (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === c, ADMIN.correo)
      if (ok) break
    }
    await page.keyboard.press('Enter')
    for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)
    check('Entra al sistema', !page.url().includes('/login'))

    // ── Se llega desde el menú lateral ────────────────────────────────────
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(3000)
    const enMenu = await page.evaluate(() =>
      Array.from(document.querySelectorAll('aside a')).some((a) => a.getAttribute('href') === '/facturacion/sunat'))
    check('Aparece "Estado SUNAT" en el menú', enMenu)

    await page.goto(`${BASE}/facturacion/sunat`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(9000)

    const vista = await page.evaluate(() => ({
      filas: document.querySelectorAll('tr[data-fila]').length,
      total: Number(document.querySelector('[data-tarjeta="todos"] [data-cantidad]')?.textContent ?? -1),
      programados: Number(document.querySelector('[data-tarjeta="programado"] [data-cantidad]')?.textContent ?? -1),
      estados: Array.from(document.querySelectorAll('[data-estado]')).map((e) => e.getAttribute('data-estado')),
      banner: document.body.innerText.match(/Modo pruebas[^\n]*|Declarando ante SUNAT[^\n]*/)?.[0] ?? '',
    }))
    check('Lista todos los del periodo', vista.filas === count, `pantalla ${vista.filas}, base ${count}`)
    check('La tarjeta "Total" coincide', vista.total === count, `${vista.total}`)
    const programadosTabla = vista.estados.filter((e) => e === 'programado').length
    check('La tarjeta "Programados" coincide con la tabla', vista.programados === programadosTabla,
      `tarjeta ${vista.programados}, tabla ${programadosTabla}`)
    check('Muestra contra qué servicio está', !!vista.banner, vista.banner)

    // ── El plazo: cuándo se declara y el panel de atrasados ──────────────
    const plazo = await page.evaluate(() => ({
      etiqueta: (document.querySelector('[data-estado="programado"]') as HTMLElement | null)?.innerText ?? '',
      atrasados: document.querySelector('[data-atrasados]')?.getAttribute('data-atrasados') ?? null,
      panel: (document.querySelector('[data-panel-plazos]') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ') ?? '',
    }))
    const esperado = (() => {
      const d = new Date(`${String(ultimo.fecha_emision)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 2)
      return d.toISOString().slice(0, 10).split('-').reverse().join('/')
    })()
    check('Se declara dos días después de la emisión', plazo.etiqueta.includes(esperado), plazo.etiqueta)
    check('El panel de plazos está y no hay nada atrasado', plazo.atrasados === '0', plazo.panel.slice(0, 140))

    // ── Filtrar con la tarjeta ────────────────────────────────────────────
    await (await page.$('[data-tarjeta="programado"]'))!.click()
    await esperar(800)
    const filtradas = await page.$$eval('tr[data-fila]', (f) => f.length)
    check('La tarjeta filtra la tabla', filtradas === programadosTabla, `${filtradas} filas`)
    await (await page.$('[data-tarjeta="todos"]'))!.click()
    await esperar(800)

    // ── Verificar con SUNAT: la ruta, autenticada como el usuario ─────────
    const r = await page.evaluate(async (id) => {
      const res = await fetch('/api/sunat/verificar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comprobante_id: id }),
      })
      return { status: res.status, cuerpo: await res.json() }
    }, muestra.id)
    const v = r.cuerpo.resultados?.[0]
    check('La verificación responde', r.status === 200 && !!v, `HTTP ${r.status}`)
    check('Le preguntó a SUNAT de verdad', !!v?.consulta?.codigo,
      `[${v?.consulta?.codigo}] ${v?.consulta?.mensaje}`)
    check('Dice qué pasa con el comprobante', !!v?.resumen, v?.resumen)
    const { data: anotado } = await (admin as any).from('comprobantes')
      .select('sunat_verificado_at, sunat_verificacion, enviado_sunat').eq('id', muestra.id).single()
    check('Dejó anotada la respuesta de SUNAT', !!anotado.sunat_verificado_at && !!anotado.sunat_verificacion,
      `${anotado.sunat_verificacion}`)
    check('No lo marcó como enviado', anotado.enviado_sunat === false)

    // ── El detalle ───────────────────────────────────────────────────────
    await page.reload({ waitUntil: 'networkidle2' })
    await esperar(8000)
    const fila = await page.$(`tr[data-fila="${muestra.serie}-${muestra.numero}"]`)
    const botonDetalle = fila ? (await fila.$$('button')).at(-1) : null
    if (botonDetalle) await botonDetalle.click()
    await esperar(2500)
    const dialogo = await page.evaluate(() => (document.querySelector('[role="dialog"]') as HTMLElement | null)?.innerText ?? '')
    check('El detalle abre', /Lo que anotó el ERP/i.test(dialogo) && /Lo que dice SUNAT/i.test(dialogo),
      dialogo.replace(/\s+/g, ' ').slice(0, 120))
    check('El detalle muestra la última verificación', /Última verificación|SUNAT no lo tiene|SUNAT confirma/.test(dialogo))
    await page.screenshot({ path: '.sunat/estado-sunat-detalle.png' })
    await page.keyboard.press('Escape')
    await esperar(800)
    await page.screenshot({ path: '.sunat/estado-sunat.png' })

    check('Sin errores de JavaScript', erroresJs.length === 0, erroresJs[0] ?? '')
  } finally {
    if (browser) await browser.close()
    // Dejar el comprobante de muestra como estaba.
    await (admin as any).from('comprobantes').update({
      sunat_verificado_at: muestra.sunat_verificado_at, sunat_verificacion: muestra.sunat_verificacion,
    }).eq('id', muestra.id)
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
    console.log('\n  Comprobante de muestra restaurado y usuario temporal eliminado.')
  }

  const bien = resultados.filter(([, ok]) => ok).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.stack, '\n'); process.exit(1) })
