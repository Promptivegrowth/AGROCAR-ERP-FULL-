/**
 * Pedidos: cambiar contado/crédito en modo edición (Daniel, 13/10). Cambia la
 * condición de un pedido real y al final la DEVUELVE a su valor original.
 *   BASE=http://localhost:3014 npx tsx scripts/verificar-tipo-pago-pedido.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3014'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
const res: boolean[] = []
const check = (q: string, ok: boolean, d = '') => { res.push(ok); console.log(`  ${ok ? 'OK  ' : 'MAL '} ${q}${d ? `  — ${d}` : ''}`) }
const S = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any
  const NUM = process.env.PEDIDO ?? 'P-28711467'
  const { data: ped } = await admin.from('pedidos').select('id, numero, estado, tipo_pago, fecha_pedido').eq('numero', NUM).maybeSingle()
  if (!ped) throw new Error(`No existe ${NUM}`)
  const original = ped.tipo_pago
  const otro = original === 'credito' ? 'contado' : 'credito'
  const ETQ: Record<string, string> = { contado: 'Contado', credito: 'Crédito' }
  console.log(`
${NUM} · ${ped.estado} · ${original} → prueba a ${otro}
`)
  const sello = Date.now()
  const cred = { correo: `zz.tpag.${sello}@agrocar.pe`, clave: `Zc-${sello}-t!` }
  const { data } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  const uid = data!.user!.id
  await admin.from('profiles').upsert({ id: uid, email: cred.correo, full_name: 'ZZ Tipo de pago', role: 'administrador', activo: true })
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page: Page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 950 })
    await page.setBypassServiceWorker(true)
    const errores: string[] = []
    page.on('pageerror', (e) => errores.push(String((e as Error).message).slice(0, 120)))
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 180000 })
    for (let i = 0; i < 5; i++) {
      await esperar(3000)
      await page.$eval('input[type="email"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.$eval('input[type="password"]', (el) => { (el as HTMLInputElement).value = '' })
      await page.type('input[type="email"]', cred.correo); await page.type('input[type="password"]', cred.clave)
      await esperar(800)
      if (await page.evaluate((x) => (document.querySelector('input[type="email"]') as HTMLInputElement)?.value === x, cred.correo)) break
    }
    await page.keyboard.press('Enter')
    for (let i = 0; i < 30 && page.url().includes('/login'); i++) await esperar(2000)
    try {
      await page.goto(`${BASE}/pedidos?desde=${ped.fecha_pedido}&hasta=${ped.fecha_pedido}`, { waitUntil: 'networkidle2', timeout: 180000 })
      await esperar(7000)
      const visto = await page.evaluate((n) => document.body.innerText.includes(n), NUM)
      if (!visto) { await page.screenshot({ path: '.sunat/tipo-pago-lista.png', fullPage: true }); console.log('  (el pedido no aparece en la lista; captura en .sunat/tipo-pago-lista.png)') }
      await page.evaluate((n) => {
        const tr = Array.from(document.querySelectorAll('tr')).find((t) => t.textContent?.includes(n))
        const botones = tr ? Array.from(tr.querySelectorAll('button')) : []
        ;(botones[botones.length - 1] as HTMLElement | undefined)?.click()
      }, NUM)
      await esperar(3000)
      let txt = await page.evaluate(() => document.body.innerText)
      check('El detalle muestra la condición de pago', txt.includes('Condición de pago') && txt.includes(ETQ[original]), ETQ[original])
      const editar = await page.$('xpath/.//button[contains(., "Editar")]')
      check('El pedido enviado tiene el botón Editar', !!editar)
      await editar!.click(); await esperar(1500)
      const sel = await page.$('[data-condicion-pago] select')
      check('En edición aparece el selector Contado / Crédito', !!sel)
      await sel!.select(otro); await esperar(500)
      const guardar = await page.$('xpath/.//div[@data-condicion-pago]//button[contains(., "Guardar")]')
      check('Al cambiarlo aparece "Guardar"', !!guardar)
      await guardar!.click(); await esperar(4000)
      txt = await page.evaluate(() => document.body.innerText)
      const { data: despues } = await admin.from('pedidos').select('tipo_pago').eq('id', ped.id).single()
      check('Se guardó en la base', despues.tipo_pago === otro, despues.tipo_pago)
      check('Avisa el cambio', txt.includes('Condición de pago actualizada'))
      await page.screenshot({ path: '.sunat/tipo-pago-pedido.png' })
      check('Sin errores de JavaScript', errores.filter((e) => !/hydrat|server-rendered/i.test(e)).length === 0, errores.join(' // '))
    } finally {
      await admin.from('pedidos').update({ tipo_pago: original }).eq('id', ped.id)
      const { data: rest } = await admin.from('pedidos').select('tipo_pago').eq('id', ped.id).single()
      check(`${NUM} quedó con su valor original (${original})`, rest.tipo_pago === original, rest.tipo_pago)
    }
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid)
  }
  console.log(`
  ${res.filter(Boolean).length} de ${res.length} comprobaciones pasaron.
`)
  if (res.some((x) => !x)) process.exit(1)
}

main().catch((e) => { console.error('FALLÓ:', e.stack); process.exit(1) })
