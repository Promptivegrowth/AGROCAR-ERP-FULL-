/**
 * ¿El QR dice lo que SUNAT espera?
 *
 * Diez campos separados por barra vertical, en un orden fijo. Se comprueba
 * sobre comprobantes reales, con firma y sin ella, porque el último campo —el
 * valor resumen— solo existe cuando el documento está firmado.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/sunat-probar-qr.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { contenidoQr } from '../src/lib/sunat/qr'
import { construirInvoice, type ItemUbl } from '../src/lib/sunat/ubl'
import { abrirCertificado, firmarXml } from '../src/lib/sunat/firma'

const EMISOR = {
  ruc: '20519883296',
  razon_social: 'AGROCAR S.R.L.',
  nombre_comercial: 'AGROCAR',
  direccion: 'CAL. EMILIO FORERO NRO 553A - TACNA',
}

const CAMPOS = [
  'RUC del emisor', 'Tipo (cat. 01)', 'Serie', 'Número', 'IGV', 'Total',
  'Fecha de emisión', 'Tipo doc. cliente', 'Documento del cliente', 'Valor resumen',
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

async function main() {
  cargarEnvLocal()
  const cert = abrirCertificado(fs.readFileSync(env('CERT_PFX')), env('CERT_PASS'))
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  const { data, error } = await supabase.from('comprobantes').select(`
    serie, numero, tipo, fecha_emision, igv, total,
    clientes(razon_social, ruc, dni, direccion),
    pedidos(tipo_pago),
    comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje,
      productos(codigo, nombre, descripcion, unidades_medida(codigo_sunat)))
  `).in('serie', ['F002', 'B002']).neq('estado', 'anulado')
    .order('fecha_emision', { ascending: false }).limit(2)
  if (error) throw error

  let bien = 0
  let total = 0

  for (const raw of (data ?? []) as any[]) {
    const c = raw

    // Sin firmar: el valor resumen queda vacío, y eso es válido.
    const sinFirma = contenidoQr({
      rucEmisor: EMISOR.ruc, tipo: c.tipo, serie: c.serie, numero: String(c.numero),
      igv: Number(c.igv), total: Number(c.total), fechaEmision: c.fecha_emision,
      cliente: c.clientes, xmlFirmado: null,
    })

    // Firmado: aparece el digest.
    const items: ItemUbl[] = c.comprobantes_items.map((it: any) => ({
      cantidad: Number(it.cantidad),
      precio_unitario: Number(it.precio_unitario),
      igv_porcentaje: it.igv_porcentaje ?? 18,
      descripcion: (it.productos?.descripcion || '').trim() || it.productos?.nombre || it.descripcion || 'PRODUCTO',
      codigo: it.productos?.codigo ?? null,
      unidad: it.productos?.unidades_medida?.codigo_sunat || 'NIU',
    }))
    const { xml } = construirInvoice({
      comprobante: {
        serie: c.serie, numero: c.numero, tipo: c.tipo, fecha_emision: c.fecha_emision,
        moneda: 'PEN', forma_pago: 'contado', cliente: c.clientes,
      },
      emisor: EMISOR,
      items,
    })
    const firmado = firmarXml(xml, cert)
    const conFirma = contenidoQr({
      rucEmisor: EMISOR.ruc, tipo: c.tipo, serie: c.serie, numero: String(c.numero),
      igv: Number(c.igv), total: Number(c.total), fechaEmision: c.fecha_emision,
      cliente: c.clientes, xmlFirmado: firmado,
    })

    const p = conFirma.split('|')
    console.log(`\n  ${c.serie}-${c.numero}  (${c.tipo})`)
    console.log(`  ${'─'.repeat(66)}`)
    p.forEach((v, i) => console.log(`   ${String(i + 1).padStart(2)}. ${CAMPOS[i].padEnd(22)} ${v.length > 34 ? v.slice(0, 34) + '…' : v}`))

    const digestReal = firmado.match(/<ds:DigestValue>([\s\S]*?)<\/ds:DigestValue>/)?.[1]?.trim() ?? ''
    const pruebas: [string, boolean][] = [
      ['Tiene exactamente 10 campos', p.length === 10],
      ['Empieza con el RUC del emisor', p[0] === EMISOR.ruc],
      ['Tipo en catálogo 01', (c.tipo === 'factura' && p[1] === '01') || (c.tipo === 'boleta' && p[1] === '03')],
      ['Serie y número separados', p[2] === c.serie && p[3] === String(c.numero)],
      ['IGV con dos decimales', p[4] === Number(c.igv).toFixed(2)],
      ['Total con dos decimales', p[5] === Number(c.total).toFixed(2)],
      ['Fecha AAAA-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(p[6])],
      ['Tipo de documento del cliente', ['0', '1', '6'].includes(p[7])],
      ['Documento del cliente', p[8] === (c.clientes?.ruc ?? c.clientes?.dni ?? '-')],
      ['Valor resumen = digest de la firma', p[9] === digestReal && digestReal.length > 0],
      ['Sin firmar, el resumen va vacío', sinFirma.split('|')[9] === '' && sinFirma.split('|').length === 10],
    ]
    console.log()
    for (const [k, ok] of pruebas) {
      total++
      if (ok) bien++
      console.log(`   ${ok ? 'OK  ' : 'MAL '} ${k}`)
    }
  }

  console.log(`\n  ${bien} de ${total} comprobaciones pasaron.\n`)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
