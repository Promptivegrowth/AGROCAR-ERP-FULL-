/**
 * Editar un comprobante tiene que volver a firmarlo.
 *
 * El QR impreso lleva el resumen de la firma, y la firma se calcula sobre un
 * XML que incluye los importes. Si se edita una línea y no se vuelve a firmar,
 * el XML guardado queda hablando del importe viejo: el envío lo reconstruye
 * desde la base y sale bien igual, pero el papel que ya está impreso deja de
 * corresponderse con lo que se va a declarar.
 *
 * Se ejerce el camino completo con un usuario de verdad:
 *
 *   - la edición va por PostgREST con el token de su sesión
 *   - la firma va por /api/sunat/firmar desde el navegador, que es donde
 *     existe la cookie que esa ruta necesita (un Bearer no le sirve)
 *
 * El comprobante se deja como estaba, pase lo que pase.
 *
 *   BASE=http://localhost:3009 npx tsx scripts/probar-refirma-al-editar.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import puppeteer, { type Browser } from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE ?? 'http://localhost:3009'

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

const CORREO = `verificacion.refirma.${Date.now()}@agrocar.pe`
const CLAVE = `Vr-${Date.now()}-tmp!`
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

const resumenDe = (xml: string | null | undefined) =>
  xml?.match(/<ds:DigestValue>([\s\S]*?)<\/ds:DigestValue>/)?.[1]?.trim() ?? ''

async function main() {
  cargarEnvLocal()
  const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
  const url = env('NEXT_PUBLIC_SUPABASE_URL')
  const anon = env('NEXT_PUBLIC_SUPABASE_ANON_KEY')

  console.log('\nVOLVER A FIRMAR AL EDITAR\n')

  const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
    email: CORREO, password: CLAVE, email_confirm: true,
  })
  if (errCrear) throw errCrear
  const userId = creado.user!.id
  await admin.from('profiles').upsert({
    id: userId, email: CORREO, full_name: 'Verificación refirma',
    role: 'administrador', activo: true,
  } as never)

  let itemOriginal: { id: string; cantidad: number } | null = null
  let xmlOriginal: string | null = null
  let compId: string | null = null
  let browser: Browser | null = null

  try {
    const sesion = await admin.auth.signInWithPassword({ email: CORREO, password: CLAVE })
    const token = sesion.data.session?.access_token
    check('El usuario obtiene sesión', !!token)
    if (!token) throw new Error('sin sesión no se puede seguir')

    const { data: victima } = await (admin as any).from('comprobantes')
      .select('id, serie, numero, total, sunat_xml, comprobantes_items(id, cantidad, precio_unitario, descripcion)')
      .in('tipo', ['factura', 'boleta'])
      .eq('enviado_sunat', false).neq('estado', 'anulado')
      .order('fecha_emision', { ascending: false }).limit(1).maybeSingle()

    const c = victima as any
    check('Hay un comprobante sin declarar para probar', !!c && c.comprobantes_items?.length > 0,
      c ? `${c.serie}-${c.numero}` : '')
    if (!c) throw new Error('no hay caso de prueba')
    compId = c.id
    xmlOriginal = c.sunat_xml ?? null

    const it = c.comprobantes_items[0]
    itemOriginal = { id: it.id, cantidad: Number(it.cantidad) }

    // ── Navegador con sesión ────────────────────────────────────────────────
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.type('input[type="email"]', CORREO)
    await page.type('input[type="password"]', CLAVE)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])
    await esperar(6000)
    check('Entra al sistema', !page.url().includes('/login'), page.url().replace(BASE, ''))

    // La misma llamada que hace la pantalla, con la cookie de la sesión.
    const firmar = async () => page.evaluate(async (id) => {
      const r = await fetch('/api/sunat/firmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comprobante_id: id }),
      })
      return { estado: r.status, cuerpo: await r.json().catch(() => null) }
    }, compId as string)

    const leerXml = async () => {
      const { data } = await (admin as any).from('comprobantes')
        .select('total, sunat_xml').eq('id', compId).maybeSingle()
      return data as { total: number; sunat_xml: string | null }
    }

    // ── 1. Firma inicial ────────────────────────────────────────────────────
    const f1 = await firmar()
    check('La pantalla puede firmar el comprobante', f1.estado === 200,
      JSON.stringify(f1.cuerpo).slice(0, 90))

    const antes = await leerXml()
    const resumenAntes = resumenDe(antes.sunat_xml)
    const totalAntes = Number(antes.total)
    check('Quedó firmado', resumenAntes.length > 0, resumenAntes.slice(0, 24) + '…')

    // ── 2. Editar una línea, con la sesión del usuario ──────────────────────
    const nuevaCantidad = itemOriginal.cantidad + 1
    const r = await fetch(`${url}/rest/v1/rpc/editar_comprobante_item`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_item_id: itemOriginal.id,
        p_descripcion: it.descripcion,
        p_cantidad: nuevaCantidad,
        p_precio_unitario: Number(it.precio_unitario),
        p_nota: 'Verificacion automatica de refirma',
      }),
    })
    check('La edición funciona con la sesión del usuario', r.status === 200,
      `cantidad ${itemOriginal.cantidad} → ${nuevaCantidad}`)

    const trasEditar = await leerXml()
    const totalDespues = Number(trasEditar.total)
    check('El total cambió al editar', Math.abs(totalDespues - totalAntes) > 0.005,
      `S/ ${totalAntes.toFixed(2)} → S/ ${totalDespues.toFixed(2)}`)
    check('La firma sigue siendo la vieja hasta que se vuelva a firmar',
      resumenDe(trasEditar.sunat_xml) === resumenAntes,
      'esperado: la RPC no firma, lo hace la pantalla')

    // ── 3. Volver a firmar, que es lo que ahora hace la pantalla ────────────
    const f2 = await firmar()
    check('Vuelve a firmar sin problema', f2.estado === 200)

    const despues = await leerXml()
    const resumenDespues = resumenDe(despues.sunat_xml)
    check('El resumen de la firma cambió',
      resumenDespues.length > 0 && resumenDespues !== resumenAntes,
      `${resumenAntes.slice(0, 14)}… → ${resumenDespues.slice(0, 14)}…`)

    const totalEnXml = Number(
      (despues.sunat_xml ?? '').match(/<cbc:PayableAmount[^>]*>([\d.]+)</)?.[1] ?? '0')
    check('El XML firmado declara el total nuevo',
      Math.abs(totalEnXml - totalDespues) < 0.005,
      `XML S/ ${totalEnXml.toFixed(2)} · base S/ ${totalDespues.toFixed(2)}`)
  } finally {
    if (browser) await browser.close()
    // Dejar todo como estaba.
    if (itemOriginal && compId) {
      await fetch(`${url}/rest/v1/comprobantes_items?id=eq.${itemOriginal.id}`, {
        method: 'PATCH',
        headers: {
          apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
          Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        },
        body: JSON.stringify({ cantidad: itemOriginal.cantidad }),
      })
      await (admin as any).from('comprobantes')
        .update({ sunat_xml: xmlOriginal }).eq('id', compId)
    }
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
    console.log('\n  Comprobante restaurado y usuario temporal eliminado.')
  }

  const bien = resultados.filter(([, ok]) => ok).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.\n`)
  if (bien !== resultados.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
