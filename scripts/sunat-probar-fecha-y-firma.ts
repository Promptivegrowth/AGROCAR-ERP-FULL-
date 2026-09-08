/**
 * ¿Qué pasa si la fecha de emisión se cambiara al momento de sincronizar?
 *
 * La idea suena razonable: el comprobante se genera el sábado, se declara el
 * lunes, y la fecha declarada sería la del lunes. Esta prueba mide la
 * consecuencia concreta sobre el papel que el cliente ya tiene en la mano.
 *
 * El QR impreso lleva diez campos, y el último es el resumen de la firma
 * digital. Se firma al emitir, así que ese resumen se calcula sobre el XML con
 * la fecha de emisión de ese momento. Si la fecha cambia después, el XML es
 * otro, la firma es otra y el resumen es otro — pero el QR ya está impreso.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/sunat-probar-fecha-y-firma.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { construirInvoice, type ItemUbl } from '../src/lib/sunat/ubl'
import { abrirCertificado, firmarXml } from '../src/lib/sunat/firma'
import { contenidoQr } from '../src/lib/sunat/qr'

const EMISOR = {
  ruc: '20519883296',
  razon_social: 'AGROCAR S.R.L.',
  nombre_comercial: 'AGROCAR',
  direccion: 'CAL. EMILIO FORERO NRO 553A - TACNA',
}

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

  // Uno de los 37 del sábado 5 para repartir el lunes 7.
  const { data, error } = await supabase.from('comprobantes').select(`
    serie, numero, tipo, fecha_emision, fecha_despacho, igv, total,
    clientes(razon_social, ruc, dni, direccion),
    comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje,
      productos(codigo, nombre, descripcion, unidades_medida(codigo_sunat)))
  `).eq('fecha_emision', '2026-09-05').eq('fecha_despacho', '2026-09-07')
    .limit(1).maybeSingle()
  if (error) throw error
  const c = data as any
  if (!c) throw new Error('No se encontró un comprobante del sábado para el lunes')

  const items: ItemUbl[] = c.comprobantes_items.map((it: any) => ({
    cantidad: Number(it.cantidad),
    precio_unitario: Number(it.precio_unitario),
    igv_porcentaje: it.igv_porcentaje ?? 18,
    descripcion: (it.productos?.descripcion || '').trim() || it.productos?.nombre || it.descripcion || 'PRODUCTO',
    codigo: it.productos?.codigo ?? null,
    unidad: it.productos?.unidades_medida?.codigo_sunat || 'NIU',
  }))

  const armarYFirmar = (fecha: string) => {
    const { xml } = construirInvoice({
      comprobante: {
        serie: c.serie, numero: c.numero, tipo: c.tipo,
        fecha_emision: fecha, moneda: 'PEN', forma_pago: 'contado',
        cliente: c.clientes,
      },
      emisor: EMISOR, items,
    })
    const firmado = firmarXml(xml, cert)
    return {
      firmado,
      resumen: firmado.match(/<ds:DigestValue>([\s\S]*?)<\/ds:DigestValue>/)?.[1]?.trim() ?? '',
      qr: contenidoQr({
        rucEmisor: EMISOR.ruc, tipo: c.tipo, serie: c.serie, numero: String(c.numero),
        igv: Number(c.igv), total: Number(c.total), fechaEmision: fecha,
        cliente: c.clientes, xmlFirmado: firmado,
      }),
    }
  }

  const alEmitir = armarYFirmar('2026-09-05')      // lo que se imprimió el sábado
  const alSincronizar = armarYFirmar('2026-09-07') // si la fecha se pusiera el lunes

  console.log(`\n  Comprobante: ${c.serie}-${c.numero}`)
  console.log(`  Emitido el 05/09, reparto el 07/09\n`)

  console.log('  LO QUE SE IMPRIMIÓ EL SÁBADO')
  console.log(`     resumen de la firma  ${alEmitir.resumen.slice(0, 44)}…`)
  console.log(`     QR                   ${alEmitir.qr.slice(0, 58)}…\n`)

  console.log('  SI LA FECHA SE PUSIERA AL SINCRONIZAR EL LUNES')
  console.log(`     resumen de la firma  ${alSincronizar.resumen.slice(0, 44)}…`)
  console.log(`     QR                   ${alSincronizar.qr.slice(0, 58)}…\n`)

  const igualResumen = alEmitir.resumen === alSincronizar.resumen
  const igualQr = alEmitir.qr === alSincronizar.qr

  console.log(`  ¿Mismo resumen de firma?  ${igualResumen ? 'sí' : 'NO'}`)
  console.log(`  ¿Mismo QR?                ${igualQr ? 'sí' : 'NO'}`)
  console.log()
  console.log(igualQr
    ? '  Cambiar la fecha no afectaría al papel.'
    : '  El QR impreso el sábado dejaría de coincidir con lo declarado el lunes:\n'
      + '  quien lo escanee para verificar el comprobante no lo encuentra igual.')
  console.log()
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
