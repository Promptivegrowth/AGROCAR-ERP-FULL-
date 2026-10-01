/**
 * Declarar guías a SUNAT a través del servidor desplegado.
 *
 * El servidor es el que tiene las credenciales de la API de SUNAT. Se entra
 * con un administrador temporal y se llama a /api/sunat/gre/enviar por cada
 * guía, en orden. Se detiene en la primera que no salga aceptada: si una
 * rebota, lo más probable es que las demás rebotarían por lo mismo.
 *
 * ENVÍA DE VERDAD: la guía no tiene ambiente de pruebas.
 *
 *   BASE=https://agrocar-erp-full.vercel.app npx tsx scripts/gre-declarar-guias.ts T001 1 7
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'https://agrocar-erp-full.vercel.app'
for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const [serie = 'T001', desdeTxt = '1', hastaTxt = desdeTxt] = process.argv.slice(2)
  const desde = Number(desdeTxt)
  const hasta = Number(hastaTxt)
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: guias } = await (admin as any).from('guias_remision').select('id, serie, numero, enviado_sunat')
    .eq('serie', serie).gte('numero', desde).lte('numero', hasta).order('numero')
  console.log(`\nDECLARAR GUÍAS ${serie} ${desde}..${hasta} — ${BASE}\n`)

  const sello = Date.now()
  const cred = { correo: `zz.gre.${sello}@agrocar.pe`, clave: `Zg-${sello}-t!` }
  const { data: creado, error } = await admin.auth.admin.createUser({ email: cred.correo, password: cred.clave, email_confirm: true })
  if (error) throw error
  const userId = creado.user!.id
  await admin.from('profiles').upsert({ id: userId, email: cred.correo, full_name: 'ZZ Declarar guías', role: 'administrador', activo: true } as never)

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setBypassServiceWorker(true)
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 120000 })
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
    if (page.url().includes('/login')) throw new Error('No pudo entrar')

    for (const g of guias) {
      const nombre = `${g.serie}-${String(g.numero).padStart(8, '0')}`
      if (g.enviado_sunat) { console.log(`  --   ${nombre} ya estaba aceptada`); continue }
      const r = await page.evaluate(async (id) => {
        const res = await fetch('/api/sunat/gre/enviar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guia_id: id, accion: 'enviar' }),
        })
        return { status: res.status, cuerpo: await res.json() }
      }, g.id)
      const c = r.cuerpo
      console.log(`  ${c.ok ? 'OK  ' : 'MAL '} ${nombre}  HTTP ${r.status} · ${c.estado ?? ''} ${c.codigo ? `[${c.codigo}]` : ''} ${c.mensaje ?? c.error ?? ''} ${c.ticket ? `· ticket ${c.ticket}` : ''}`)
      if (!c.ok) {
        console.log('\n  Se detiene acá: revisar antes de seguir con las demás.')
        break
      }
      await esperar(1500)
    }
  } finally {
    if (browser) await browser.close()
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
  }
  const { data: fin } = await (admin as any).from('guias_remision').select('serie, numero, sunat_estado, sunat_codigo, sunat_mensaje, enviado_sunat')
    .eq('serie', serie).gte('numero', desde).lte('numero', hasta).order('numero')
  console.log('\n  Estado en la base:')
  for (const f of fin) console.log(`    ${f.serie}-${f.numero}: ${f.sunat_estado ?? 'sin enviar'}${f.sunat_codigo ? ` [${f.sunat_codigo}]` : ''} ${f.sunat_mensaje ?? ''}`)
  console.log()
}
main().catch((e) => { console.error('\nFALLÓ:', e.stack); process.exit(1) })
