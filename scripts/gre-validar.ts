/**
 * Validar la guía de remisión con todo lo que se puede validar sin SUNAT.
 *
 * **No hay dónde probarla.** Verificado el 2026-09-30:
 *
 *   - el API REST de guías no tiene ambiente de pruebas: lo que se manda,
 *     queda declarado
 *   - el viejo beta SOAP de guías —`ol-ti-itemision-guia-gem-beta`— responde
 *     0306 ("no se puede parsear el XML") a CUALQUIER documento, incluida una
 *     factura que su propio beta acepta sin una queja. Ese servicio quedó atrás
 *     cuando la GRE se mudó a REST en 2022
 *
 * Así que esto comprueba lo demás: que el XML se arme con datos reales, que
 * parsee, que tenga los nodos que SUNAT exige, que la firma quede dentro de la
 * extensión y que el ZIP salga con el nombre correcto.
 *
 * Lo que NO se puede saber hasta el primer envío real es si SUNAT acepta el
 * contenido. Por eso el envío está apagado y detrás de una fecha de corte.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/gre-validar.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { construirGuiaRemision, type ItemGuia } from '../src/lib/sunat/gre-ubl'
import { abrirCertificado, firmarXml } from '../src/lib/sunat/firma'
import { comprimirGuia } from '../src/lib/sunat/gre-envio'

const EMISOR = {
  ruc: '20519883296',
  razon_social: 'AGROCAR S.R.L.',
  nombre_comercial: 'AGROCAR',
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

const resultados: [string, boolean, string][] = []
const check = (que: string, ok: boolean, detalle = '') => {
  resultados.push([que, ok, detalle])
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${que}${detalle ? `  — ${detalle}` : ''}`)
}

async function main() {
  cargarEnvLocal()
  const cert = abrirCertificado(fs.readFileSync(env('CERT_PFX')), env('CERT_PASS'))
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  console.log('\nLA GUÍA DE REMISIÓN, CON DATOS REALES\n')

  const { data, error } = await (supabase as any).from('guias_remision').select(`
    id, serie, numero, fecha_emision, fecha_inicio_traslado,
    motivo_traslado, motivo_descripcion, modalidad_traslado,
    punto_partida, punto_llegada, ubigeo_partida, ubigeo_llegada,
    peso_bruto_total, unidad_peso, vehiculo_placa,
    conductor_nombre, conductor_doc, conductor_licencia,
    transportista_ruc, transportista_razon_social,
    cliente_externo_nombre, cliente_externo_doc,
    clientes(razon_social, ruc, dni, ubigeo),
    comprobantes(tipo, serie, numero),
    guias_remision_items(codigo, descripcion, cantidad, unidad_medida, orden)
  `).order('numero', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error

  const g = data as any
  check('Hay una guía real para probar', !!g,
    g ? `${g.serie}-${String(g.numero).padStart(8, '0')}` : '')
  if (!g) { process.exit(1) }

  const cli = g.clientes ?? {}
  const items: ItemGuia[] = ((g.guias_remision_items ?? []) as any[])
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    .map((it) => ({
      codigo: it.codigo ?? null,
      descripcion: (it.descripcion ?? '').trim() || 'PRODUCTO',
      cantidad: Number(it.cantidad ?? 0),
      unidad: it.unidad_medida || 'NIU',
    }))
  check('Tiene productos que trasladar', items.length > 0, `${items.length} líneas`)

  const ubigeoLlegada = String(g.ubigeo_llegada ?? cli.ubigeo ?? '').trim()
  check('Sale el ubigeo de llegada (del cliente si la guía no lo tiene)',
    /^\d{6}$/.test(ubigeoLlegada), ubigeoLlegada || 'falta')

  const hoy = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)
  const partes = String(g.conductor_nombre ?? '').trim().split(/\s+/)

  let firmado = ''
  let nombreArchivo = ''
  try {
    const r = construirGuiaRemision({
      guia: {
        serie: g.serie,
        numero: g.numero,
        fecha_emision: String(g.fecha_emision ?? '').slice(0, 10) || hoy,
        fecha_inicio_traslado: String(g.fecha_inicio_traslado ?? '').slice(0, 10) || hoy,
        motivo_traslado: g.motivo_traslado,
        motivo_descripcion: g.motivo_descripcion,
        peso_bruto_total: Number(g.peso_bruto_total ?? 0),
        unidad_peso: g.unidad_peso || 'KGM',
        partida: { ubigeo: String(g.ubigeo_partida ?? ''), direccion: g.punto_partida ?? '' },
        llegada: { ubigeo: ubigeoLlegada, direccion: g.punto_llegada ?? '' },
        destinatario: {
          razon_social: cli.razon_social ?? g.cliente_externo_nombre ?? '—',
          ruc: cli.ruc ?? null,
          dni: cli.dni ?? g.cliente_externo_doc ?? null,
        },
        transporte: {
          modalidad: g.modalidad_traslado,
          placa: g.vehiculo_placa,
          conductor_nombres: partes.slice(0, 2).join(' ') || '-',
          conductor_apellidos: partes.slice(2).join(' ') || partes.slice(0, 1).join(' ') || '-',
          conductor_doc: g.conductor_doc,
          conductor_licencia: g.conductor_licencia,
          transportista_ruc: g.transportista_ruc,
          transportista_razon_social: g.transportista_razon_social,
        },
        comprobante_relacionado: g.comprobantes
          ? {
            tipo: g.comprobantes.tipo === 'factura' ? '01' : '03',
            serie: g.comprobantes.serie,
            numero: g.comprobantes.numero,
          }
          : null,
      },
      emisor: EMISOR,
      items,
    })
    nombreArchivo = r.nombreArchivo
    firmado = firmarXml(r.xml, cert)
    check('El XML se arma y se firma', true, nombreArchivo)
  } catch (e) {
    check('El XML se arma y se firma', false, e instanceof Error ? e.message : String(e))
    console.log(`\n  ${resultados.filter(([, o]) => o).length} de ${resultados.length} pasaron.\n`)
    process.exit(1)
  }

  // ── Lo que SUNAT exige, comprobado sobre el XML firmado ─────────────────
  const nodos: [string, RegExp][] = [
    ['Es una guía del remitente (tipo 09)', /<cbc:DespatchAdviceTypeCode>09</],
    ['La serie tiene el formato T### que SUNAT exige', /<cbc:ID>T\w{3}-\d{8}<\/cbc:ID>/],
    ['Lleva ubigeo de partida', /<cac:DespatchAddress>[\s\S]*?Ubigeos">\d{6}</],
    ['Lleva ubigeo de llegada', /<cac:DeliveryAddress>[\s\S]*?Ubigeos">\d{6}</],
    ['Lleva el peso bruto', /<cbc:GrossWeightMeasure unitCode="\w+">[\d.]+</],
    ['Lleva el motivo de traslado', /<cbc:HandlingCode>\d{2}</],
    ['Lleva la fecha de inicio del traslado', /<cbc:StartDate>\d{4}-\d{2}-\d{2}</],
    ['Identifica al destinatario', /<cac:DeliveryCustomerParty>/],
    ['Tiene al menos una línea', /<cac:DespatchLine>/],
  ]
  for (const [que, patron] of nodos) check(que, patron.test(firmado))

  // En traslado propio tienen que ir el vehículo y el conductor.
  if (g.modalidad_traslado === 'privado') {
    check('Traslado propio: va la placa', /<cac:TransportEquipment>[\s\S]*?<cbc:ID>\w+</.test(firmado))
    check('Traslado propio: va el conductor', /<cac:DriverPerson>/.test(firmado))
  }

  check('La firma queda dentro de la extensión',
    firmado.indexOf('<ds:Signature') > firmado.indexOf('<ext:ExtensionContent')
    && firmado.indexOf('<ds:Signature') < firmado.indexOf('</ext:UBLExtensions>'))

  check('El XML cierra bien', firmado.trim().endsWith('</DespatchAdvice>'))

  const zip = await comprimirGuia(nombreArchivo, firmado)
  check('El ZIP se arma con el nombre que espera SUNAT',
    /^\d{11}-09-T\w{3}-\d{8}$/.test(nombreArchivo) && zip.length > 0,
    `${nombreArchivo}.zip · ${zip.length} bytes`)

  fs.mkdirSync('.sunat', { recursive: true })
  fs.writeFileSync(`.sunat/${nombreArchivo}.xml`, firmado)

  console.log('\n  No se envía nada: la guía no tiene ambiente de pruebas.')
  console.log('  El primer envío real será el primero que SUNAT vea.')

  const bien = resultados.filter(([, ok]) => ok).length
  console.log(`\n  ${bien} de ${resultados.length} comprobaciones pasaron.`)
  console.log(`  XML en .sunat/${nombreArchivo}.xml\n`)
  if (bien !== resultados.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
