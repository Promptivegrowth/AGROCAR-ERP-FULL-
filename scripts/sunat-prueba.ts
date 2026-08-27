/**
 * Prueba de punta a punta contra el servicio BETA de SUNAT.
 *
 * Toma una factura o boleta real del ERP, la convierte a UBL 2.1, la firma con
 * el certificado de AGROCAR, la comprime y la manda. Lo que importa es el CDR
 * que devuelve SUNAT: ahí dice si el XML está bien o exactamente qué falta.
 *
 *   CERT_PFX=ruta.pfx CERT_PASS=... npx tsx scripts/sunat-prueba.ts [F002-00000044]
 *
 * Ni la ruta del certificado ni su contraseña se escriben acá: viajan por
 * variables de entorno para que nunca entren al repositorio.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { construirInvoice, type ItemUbl } from '../src/lib/sunat/ubl'
import { abrirCertificado, firmarXml, comprimir, enviarASunat } from '../src/lib/sunat/firma'

const EMISOR = {
  ruc: '20519883296',
  razon_social: 'AGROCAR S.R.L.',
  nombre_comercial: 'AGROCAR',
  direccion: 'CAL. EMILIO FORERO NRO 553A - TACNA',
}

const SALIDA = path.join(process.cwd(), '.sunat')

function env(nombre: string): string {
  const v = process.env[nombre]
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`)
  return v
}

/** Lee .env.local sin depender de que Next lo cargue. */
function cargarEnvLocal() {
  const f = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(f)) return
  for (const linea of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

async function main() {
  cargarEnvLocal()
  fs.mkdirSync(SALIDA, { recursive: true })

  // ── 1. El certificado ────────────────────────────────────────────────────
  console.log('\n1. CERTIFICADO')
  const cert = abrirCertificado(fs.readFileSync(env('CERT_PFX')), env('CERT_PASS'))
  console.log(`   titular: ${cert.titular}`)
  console.log(`   vence:   ${cert.vence.toISOString().slice(0, 10)}`)

  // ── 2. El comprobante, tal como está en el ERP ───────────────────────────
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
  const pedido = process.argv[2]

  let q = supabase.from('comprobantes').select(`
    id, serie, numero, tipo, fecha_emision, subtotal, igv, total, moneda, estado,
    clientes(razon_social, ruc, dni, direccion),
    comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje,
      productos(codigo, nombre, descripcion, unidades_medida(codigo_sunat)))
  `).neq('estado', 'anulado')

  if (pedido) {
    const [serie, numero] = pedido.split('-')
    q = q.eq('serie', serie).eq('numero', numero)
  } else {
    q = q.eq('tipo', 'factura').order('fecha_emision', { ascending: false }).limit(1)
  }

  const { data, error } = await q
  if (error) throw error
  if (!data?.length) throw new Error(`No se encontró el comprobante ${pedido ?? '(última factura)'}`)
  const c = data[0] as any

  console.log('\n2. COMPROBANTE')
  console.log(`   ${c.serie}-${c.numero}  ${c.tipo}  ${c.fecha_emision}  S/ ${c.total}`)
  console.log(`   cliente: ${c.clientes?.razon_social ?? '—'}`)

  const items: ItemUbl[] = c.comprobantes_items.map((it: any) => ({
    cantidad: Number(it.cantidad),
    precio_unitario: Number(it.precio_unitario),
    igv_porcentaje: it.igv_porcentaje ?? 18,
    descripcion: (it.productos?.descripcion || '').trim() || it.productos?.nombre || it.descripcion || 'PRODUCTO',
    codigo: it.productos?.codigo ?? null,
    unidad: it.productos?.unidades_medida?.codigo_sunat || 'NIU',
  }))

  // ── 3. El XML ────────────────────────────────────────────────────────────
  const { xml, nombreArchivo, totales } = construirInvoice({
    comprobante: {
      serie: c.serie, numero: c.numero, tipo: c.tipo,
      fecha_emision: c.fecha_emision, moneda: c.moneda || 'PEN',
      cliente: c.clientes,
    },
    emisor: EMISOR,
    items,
  })

  console.log('\n3. UBL 2.1')
  console.log(`   calculado:  gravado ${totales.gravado}  + igv ${totales.igv}  = ${totales.total}`)
  console.log(`   en la base: gravado ${c.subtotal}  + igv ${c.igv}  = ${c.total}`)
  const cuadra = Math.abs(totales.total - Number(c.total)) < 0.01
  console.log(`   ${cuadra ? '   cuadra con el ERP' : '   *** NO CUADRA — revisar antes de seguir ***'}`)

  // ── 4. La firma ──────────────────────────────────────────────────────────
  const firmado = firmarXml(xml, cert)
  fs.writeFileSync(path.join(SALIDA, `${nombreArchivo}.xml`), firmado, 'utf8')
  console.log('\n4. FIRMA')
  console.log(`   dentro de ExtensionContent: ${/<ext:ExtensionContent>\s*<ds:Signature/.test(firmado) ? 'sí' : 'NO'}`)
  console.log(`   guardado: .sunat/${nombreArchivo}.xml`)

  // ── 5. El ZIP ────────────────────────────────────────────────────────────
  const zip = await comprimir(nombreArchivo, firmado)
  fs.writeFileSync(path.join(SALIDA, `${nombreArchivo}.zip`), zip)
  console.log(`\n5. ZIP  (${zip.length} bytes)`)

  // ── 6. A SUNAT ───────────────────────────────────────────────────────────
  console.log('\n6. ENVÍO A BETA')
  const r = await enviarASunat({
    modo: 'beta',
    usuario: `${EMISOR.ruc}MODDATOS`,
    clave: 'MODDATOS',
    nombreArchivo,
    zip,
  })

  console.log(`   respuesta: ${r.tipo}`)
  console.log(`   código:    ${r.codigo ?? '—'}`)
  console.log(`   dice:      ${r.mensaje ?? '—'}`)
  if (r.observaciones?.length) {
    console.log('   observaciones:')
    r.observaciones.forEach((o) => console.log(`     · ${o}`))
  }
  if (r.cdrXml) fs.writeFileSync(path.join(SALIDA, `R-${nombreArchivo}.xml`), r.cdrXml, 'utf8')
  if (r.crudo) fs.writeFileSync(path.join(SALIDA, 'respuesta-cruda.xml'), r.crudo, 'utf8')

  console.log(`\n   ${r.ok ? '>>> ACEPTADO POR SUNAT <<<' : '>>> falta corregir algo <<<'}\n`)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
