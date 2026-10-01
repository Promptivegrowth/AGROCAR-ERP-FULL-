/**
 * Ensayo en BETA de los comprobantes reales que están por declararse.
 *
 * Antes de pasar a producción, cada comprobante pendiente se arma exactamente
 * como lo arma `declararComprobante` y se manda al servicio de pruebas de
 * SUNAT, que valida todo y no declara nada. Lo que rebote acá rebotaría en
 * producción, y se ve antes de que cuente.
 *
 * No escribe NADA en la base. No se usa `declararComprobante` a propósito: esa
 * función anota el resultado, y en beta dejaría `enviado_sunat` en verdadero;
 * el barrido de producción salta los que ya figuran enviados, así que el
 * comprobante no se declararía nunca.
 *
 * La fecha se cambia por la de hoy SOLO en el XML de ensayo: SUNAT rechaza con
 * 2329 lo fechado adelante, y lo que se emite a la noche lleva la fecha del
 * reparto de mañana. Todo lo demás —ítems, totales, cliente, forma de pago,
 * vencimiento— es lo que se va a declarar.
 *
 *   CERT_PFX=... CERT_PASS=... npx tsx scripts/sunat-ensayo-beta.ts [desde]
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { construirInvoice, type ItemUbl } from '../src/lib/sunat/ubl'
import { abrirCertificado, firmarXml, comprimir, enviarASunat } from '../src/lib/sunat/firma'
import { EMISOR_SUNAT } from '../src/lib/sunat/config'
import { hoyLima } from '../src/lib/fechas-pe'

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

// Las mismas columnas que lee declararComprobante.
const SELECT = `
  id, serie, numero, tipo, fecha_emision, total, estado,
  clientes(razon_social, ruc, dni, direccion, credito_dias),
  pedidos(tipo_pago),
  comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje,
    productos(codigo, nombre, descripcion, unidades_medida(codigo_sunat)))
`

async function main() {
  cargarEnvLocal()
  const desde = process.argv[2] ?? hoyLima()
  const hoy = hoyLima()
  const cert = abrirCertificado(fs.readFileSync(env('CERT_PFX')), env('CERT_PASS'))
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  const { data, error } = await (supabase as any).from('comprobantes').select(SELECT)
    .in('tipo', ['factura', 'boleta']).neq('estado', 'anulado').eq('enviado_sunat', false)
    .gte('fecha_emision', desde).order('serie').order('numero')
  if (error) throw new Error(error.message)
  const lista = (data ?? []) as any[]

  console.log(`\nENSAYO EN BETA — ${lista.length} comprobantes desde ${desde} (fecha de ensayo ${hoy})\n`)

  let aceptados = 0
  const problemas: string[] = []
  for (const c of lista) {
    const nombre = `${c.serie}-${c.numero}`
    const items: ItemUbl[] = (c.comprobantes_items ?? []).map((it: any) => ({
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
      const d = new Date(`${hoy}T12:00:00Z`)
      d.setUTCDate(d.getUTCDate() + diasCredito)
      vencimiento = d.toISOString().slice(0, 10)
    }

    try {
      const { xml, nombreArchivo, totales } = construirInvoice({
        comprobante: {
          serie: c.serie, numero: c.numero, tipo: c.tipo,
          fecha_emision: hoy,
          moneda: 'PEN',
          forma_pago: esCredito ? 'credito' : 'contado',
          fecha_vencimiento: vencimiento,
          cliente: c.clientes,
        },
        emisor: EMISOR_SUNAT,
        items,
      })
      // La misma barrera que en producción: lo impreso y lo declarado, iguales.
      if (Math.abs(totales.total - Number(c.total)) > 0.005) {
        const msg = `${nombre}: total XML ${totales.total.toFixed(2)} ≠ impreso ${Number(c.total).toFixed(2)}`
        problemas.push(msg)
        console.log(`  DESCUADRE ${msg}`)
        continue
      }
      const zip = await comprimir(nombreArchivo, firmarXml(xml, cert))
      const r = await enviarASunat({
        modo: 'beta', usuario: `${EMISOR_SUNAT.ruc}MODDATOS`, clave: 'MODDATOS', nombreArchivo, zip,
      })
      const ok = r.codigo === '0' || r.codigo === '4000'
      if (ok) aceptados++
      else problemas.push(`${nombre}: ${r.codigo} ${r.mensaje}`)
      const obs = r.observaciones?.length ? `  obs: ${r.observaciones.join(' | ').slice(0, 120)}` : ''
      console.log(`  ${ok ? 'OK  ' : 'MAL '} ${nombre}  ${c.tipo.padEnd(7)} S/ ${Number(c.total).toFixed(2).padStart(9)}  ${r.codigo} ${(r.mensaje ?? '').slice(0, 70)}${obs}`)
    } catch (e) {
      const msg = `${nombre}: ${e instanceof Error ? e.message : e}`
      problemas.push(msg)
      console.log(`  ERROR ${msg}`)
    }
    await new Promise((res) => setTimeout(res, 1200))
  }

  console.log(`\n  ${aceptados} de ${lista.length} aceptados en beta.`)
  if (problemas.length) {
    console.log('\n  PROBLEMAS:')
    problemas.forEach((p) => console.log(`    ${p}`))
  }
  console.log()
  if (problemas.length) process.exit(1)
}

main().catch((e) => { console.error('\nFALLÓ:', e.stack, '\n'); process.exit(1) })
