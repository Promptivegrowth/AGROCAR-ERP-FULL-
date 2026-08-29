/**
 * La cadena que hace que el ticket salga con el QR completo.
 *
 *   emitir  ->  firmar (local)  ->  guardar el XML  ->  el QR lee su digest
 *
 * Se ejercita entera sobre un comprobante real, se comprueba que el ultimo
 * campo del QR quede lleno, y se deja la fila como estaba.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/sunat-probar-firma-al-emitir.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

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

async function main() {
  cargarEnvLocal()
  process.env.SUNAT_CERT_BASE64 = fs.readFileSync(env('CERT_PFX')).toString('base64')
  process.env.SUNAT_CERT_PASSWORD = env('CERT_PASS')

  const { configuracionSunat, EMISOR_SUNAT } = await import('../src/lib/sunat/config')
  const { construirInvoice } = await import('../src/lib/sunat/ubl')
  type ItemUbl = import('../src/lib/sunat/ubl').ItemUbl
  const { firmarXml } = await import('../src/lib/sunat/firma')
  const { contenidoQr } = await import('../src/lib/sunat/qr')

  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  const { data, error } = await supabase.from('comprobantes').select(`
    id, serie, numero, tipo, fecha_emision, igv, total, sunat_xml, enviado_sunat,
    clientes(razon_social, ruc, dni, direccion, credito_dias),
    pedidos(tipo_pago),
    comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje,
      productos(codigo, nombre, descripcion, unidades_medida(codigo_sunat)))
  `).eq('serie', 'B002').neq('estado', 'anulado')
    .order('fecha_emision', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  const c = data as any
  if (!c) throw new Error('No hay comprobante de prueba')

  const xmlAntes = c.sunat_xml
  console.log(`\n  Comprobante: ${c.serie}-${c.numero}`)

  // ── Antes de firmar: el QR sale sin el valor resumen ─────────────────────
  const qrSinFirma = contenidoQr({
    rucEmisor: EMISOR_SUNAT.ruc, tipo: c.tipo, serie: c.serie, numero: String(c.numero),
    igv: Number(c.igv), total: Number(c.total), fechaEmision: c.fecha_emision,
    cliente: c.clientes, xmlFirmado: null,
  })

  // ── Firmar, igual que hace la ruta al emitir ─────────────────────────────
  const conf = await configuracionSunat()
  const items: ItemUbl[] = c.comprobantes_items.map((it: any) => ({
    cantidad: Number(it.cantidad),
    precio_unitario: Number(it.precio_unitario),
    igv_porcentaje: it.igv_porcentaje ?? 18,
    descripcion: (it.productos?.descripcion || '').trim() || it.productos?.nombre || it.descripcion || 'PRODUCTO',
    codigo: it.productos?.codigo ?? null,
    unidad: it.productos?.unidades_medida?.codigo_sunat || 'NIU',
  }))
  const diasCredito = Number(c.clientes?.credito_dias ?? 0)
  const esCredito = c.pedidos?.tipo_pago === 'credito' && diasCredito > 0
  let vencimiento: string | null = null
  if (esCredito) {
    const d = new Date(`${c.fecha_emision}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + diasCredito)
    vencimiento = d.toISOString().slice(0, 10)
  }
  const { xml } = construirInvoice({
    comprobante: {
      serie: c.serie, numero: c.numero, tipo: c.tipo, fecha_emision: c.fecha_emision,
      moneda: 'PEN', forma_pago: esCredito ? 'credito' : 'contado',
      fecha_vencimiento: vencimiento, cliente: c.clientes,
    },
    emisor: EMISOR_SUNAT,
    items,
  })
  const firmado = firmarXml(xml, conf.certificado)
  await supabase.from('comprobantes').update({ sunat_xml: firmado } as any).eq('id', c.id)

  // ── Leer como lo lee la pantalla de impresión ────────────────────────────
  const { data: leido } = await supabase.from('comprobantes')
    .select('sunat_xml').eq('id', c.id).maybeSingle()
  const guardado = (leido as any)?.sunat_xml as string | null

  const qrConFirma = contenidoQr({
    rucEmisor: EMISOR_SUNAT.ruc, tipo: c.tipo, serie: c.serie, numero: String(c.numero),
    igv: Number(c.igv), total: Number(c.total), fechaEmision: c.fecha_emision,
    cliente: c.clientes, xmlFirmado: guardado,
  })

  // ── Firmar de nuevo tiene que dar lo mismo ───────────────────────────────
  const otraVez = firmarXml(
    construirInvoice({
      comprobante: {
        serie: c.serie, numero: c.numero, tipo: c.tipo, fecha_emision: c.fecha_emision,
        moneda: 'PEN', forma_pago: esCredito ? 'credito' : 'contado',
        fecha_vencimiento: vencimiento, cliente: c.clientes,
      },
      emisor: EMISOR_SUNAT,
      items,
    }).xml,
    conf.certificado,
  )
  const digest = (x: string | null) => x?.match(/<ds:DigestValue>([\s\S]*?)<\/ds:DigestValue>/)?.[1]?.trim() ?? ''

  const pruebas: [string, boolean][] = [
    ['Sin firmar, el QR tiene 10 campos y el último vacío',
      qrSinFirma.split('|').length === 10 && qrSinFirma.split('|')[9] === ''],
    ['El XML firmado quedó guardado en la base', !!guardado && guardado.length > 1000],
    ['El XML guardado tiene la firma dentro de ExtensionContent',
      /<ext:ExtensionContent>\s*<ds:Signature/.test(guardado ?? '')],
    ['Ya firmado, el QR trae el valor resumen', qrConFirma.split('|')[9].length > 20],
    ['El valor resumen es el digest del XML guardado', qrConFirma.split('|')[9] === digest(guardado)],
    ['Firmar dos veces da el mismo digest', digest(otraVez) === digest(guardado)],
    ['Los otros nueve campos no cambiaron al firmar',
      qrSinFirma.split('|').slice(0, 9).join('|') === qrConFirma.split('|').slice(0, 9).join('|')],
  ]

  console.log()
  let bien = 0
  for (const [k, ok] of pruebas) {
    if (ok) bien++
    console.log(`  ${ok ? 'OK  ' : 'MAL '} ${k}`)
  }

  console.log(`\n  QR final: ${qrConFirma.slice(0, 72)}…`)

  // Dejar la fila como estaba.
  await supabase.from('comprobantes').update({ sunat_xml: xmlAntes } as any).eq('id', c.id)
  const { data: fin } = await supabase.from('comprobantes').select('sunat_xml').eq('id', c.id).maybeSingle()
  const restaurado = ((fin as any)?.sunat_xml ?? null) === (xmlAntes ?? null)
  console.log(`  ${restaurado ? 'OK  ' : 'MAL '} La fila quedó como estaba`)

  console.log(`\n  ${bien + (restaurado ? 1 : 0)} de ${pruebas.length + 1} comprobaciones pasaron.\n`)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
