/**
 * Prueba de la nota de crédito contra el servicio BETA.
 *
 * Todavía no se emitió ninguna en el ERP, así que la nota se arma aquí sobre
 * un comprobante real: se toma una factura y una boleta ya aceptadas y se
 * genera la nota que las anularía. Beta no coteja contra datos reales —valida
 * la estructura— y eso es justo lo que hay que probar antes de necesitarla en
 * serio, que va a ser el día que Daniel tenga que corregir algo.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/sunat-prueba-nota-credito.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { construirNotaCredito, MOTIVOS_NOTA_CREDITO } from '../src/lib/sunat/nota-credito'
import type { ItemUbl } from '../src/lib/sunat/ubl'
import { abrirCertificado, firmarXml, comprimir, enviarASunat } from '../src/lib/sunat/firma'

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
  fs.mkdirSync('.sunat', { recursive: true })

  // Un caso por cada motivo que Daniel va a usar de verdad, sobre documentos
  // de los dos tipos: anular una factura y devolver mercadería de una boleta.
  const casos = [
    { afectado: 'F002-00000044', tipoAfectado: '01', motivo: '01', correlativo: '00000001' },
    { afectado: 'B002-00000288', tipoAfectado: '03', motivo: '06', correlativo: '00000002' },
    { afectado: 'B002-00000311', tipoAfectado: '03', motivo: '07', correlativo: '00000003' },
  ]

  let bien = 0
  for (const caso of casos) {
    const [serie, numero] = caso.afectado.split('-')
    const { data, error } = await supabase.from('comprobantes').select(`
      serie, numero, tipo, total,
      clientes(razon_social, ruc, dni, direccion),
      comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje,
        productos(codigo, nombre, descripcion, unidades_medida(codigo_sunat)))
    `).eq('serie', serie).eq('numero', numero).limit(1)
    if (error) throw error
    const c = (data ?? [])[0] as any
    if (!c) { console.log(`  ${caso.afectado}: no existe, se salta`); continue }

    // Motivo 07 devuelve un solo ítem; los demás anulan el comprobante entero.
    const origen = caso.motivo === '07' ? c.comprobantes_items.slice(0, 1) : c.comprobantes_items
    const items: ItemUbl[] = origen.map((it: any) => ({
      cantidad: Number(it.cantidad),
      precio_unitario: Number(it.precio_unitario),
      igv_porcentaje: it.igv_porcentaje ?? 18,
      descripcion: (it.productos?.descripcion || '').trim() || it.productos?.nombre || it.descripcion || 'PRODUCTO',
      codigo: it.productos?.codigo ?? null,
      unidad: it.productos?.unidades_medida?.codigo_sunat || 'NIU',
    }))

    const { xml, nombreArchivo, totales } = construirNotaCredito({
      nota: {
        serie: 'FC01',
        numero: caso.correlativo,
        fecha_emision: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }),
        moneda: 'PEN',
        motivo: caso.motivo,
        documento_afectado: caso.afectado,
        tipo_afectado: caso.tipoAfectado,
        cliente: c.clientes,
      },
      emisor: EMISOR,
      items,
    })

    const zip = await comprimir(nombreArchivo, firmarXml(xml, cert))
    fs.writeFileSync(path.join('.sunat', `${nombreArchivo}.xml`), firmarXml(xml, cert), 'utf8')

    const r = await enviarASunat({
      modo: 'beta', usuario: `${EMISOR.ruc}MODDATOS`, clave: 'MODDATOS', nombreArchivo, zip,
    })
    if (r.cdrXml) fs.writeFileSync(path.join('.sunat', `R-${nombreArchivo}.xml`), r.cdrXml, 'utf8')

    const ok = r.codigo === '0' || r.codigo === '4000'
    if (ok) bien++
    console.log(`\n  FC01-${caso.correlativo}  anula ${caso.afectado}  ·  motivo ${caso.motivo} (${MOTIVOS_NOTA_CREDITO[caso.motivo]})`)
    console.log(`     ${items.length} línea(s) · S/ ${totales.total.toFixed(2)}`)
    console.log(`     [${r.codigo}] ${r.mensaje}`)

    await new Promise((res) => setTimeout(res, 1500))
  }

  console.log(`\n  ${bien} de ${casos.length} notas de crédito aceptadas.\n`)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
