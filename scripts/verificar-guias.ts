/**
 * El apartado de guías y su impresión, en vivo.
 *
 * Daniel: ver la correlatividad de las guías, su estado en SUNAT y
 * reimprimirlas. Solo mira: no declara ni modifica nada.
 *
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-guias.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3014'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
const resultados: boolean[] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push(ok)
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  console.log(`\nGUÍAS DE REMISIÓN — ${BASE}\n`)
  const { data: base } = await (admin as any).from('guias_remision').select('id, serie, numero, enviado_sunat').order('numero')
  const aceptadas = base.filter((g: any) => g.enviado_sunat).length
  const sello = Date.now()
  const cred = { correo: `zz.guias.${sello}@agrocar.pe`, clave: `Zq-${sello}-t!` }
  const { data: creado } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const userId = creado!.user!.id
  await admin.from('profiles').upsert({ id: userId, email: cred.correo, full_name: 'ZZ Guías', role: 'administrador', activo: true } as never)

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 1000 })
    await page.emulateTimezone('America/Lima')
    await page.setBypassServiceWorker(true)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(String((e as Error).message).slice(0, 120)))
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 180000 })
    for (let i = 0; i < 5; i++) {
      await esperar(3000)
      await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.type('input[type="email"]', cred.correo)
      await page.type('input[type="password"]', cred.clave)
      await esperar(800)
      if (await page.evaluate((c) => (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === c, cred.correo)) break
    }
    await page.keyboard.press('Enter')
    for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)

    await page.goto(`${BASE}/facturacion/guias`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(8000)
    const v = await page.evaluate(() => ({
      filas: document.querySelectorAll('tr[data-guia]').length,
      aceptadas: document.querySelectorAll('[data-estado="aceptada"]').length,
      serie: (document.querySelector('[data-serie="T002"]') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ') ?? '',
      alerta: !!document.querySelector('[data-alerta-guias]'),
      enMenu: Array.from(document.querySelectorAll('aside a')).some((a) => a.getAttribute('href') === '/facturacion/guias'),
    }))
    check('Aparece en el menú', v.enMenu)
    check('Lista todas las guías del mes', v.filas === base.length, `${v.filas} de ${base.length}`)
    check('Marca las aceptadas por SUNAT', v.aceptadas === aceptadas, `${v.aceptadas}`)
    check('Correlatividad de T002', /00000001 → 00000007/.test(v.serie) && /Sin saltos/.test(v.serie), v.serie)
    check('Sin alerta de pendientes (todas aceptadas)', !v.alerta)

    // La reimpresión
    const g1 = base[0]
    await page.goto(`${BASE}/guia/${g1.id}`, { waitUntil: 'networkidle2', timeout: 180000 })
    await esperar(3000)
    const imp = await page.evaluate(() => ({
      texto: document.body.innerText,
      qr: !!document.querySelector('img[alt="QR"]'),
    }))
    check('La impresión muestra T002', imp.texto.includes(`T002-00000001`))
    check('Aceptada: lleva el QR de SUNAT', imp.qr)
    check('Aceptada: no dice "NO DECLARADA"', !imp.texto.includes('NO DECLARADA'))
    await page.screenshot({ path: '.sunat/guia-impresa.png', fullPage: false })
    check('Sin errores de JavaScript', errores.length === 0, errores[0] ?? '')
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
  }
  const bien = resultados.filter(Boolean).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}
main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
