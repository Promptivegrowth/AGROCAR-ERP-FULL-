/**
 * ¿Cuántos comprobantes rechazaría la barrera de totales al declararlos?
 *
 * Antes de enviar, el sistema arma el XML y compara el total que le sale con el
 * que el cliente tiene impreso. Si difieren, no envía: prefiere cortar antes que
 * declarar un importe distinto del que está en el papel.
 *
 * Hay productos que se venden por peso —3.150 kg, 0.850 kg— y cuyo importe cae
 * justo en la mitad del céntimo: 3.150 × 23.50 = 74.025. Ahí el ERP y el
 * constructor del XML pueden redondear para lados distintos, y el comprobante
 * queda trabado sin que nadie entienda por qué.
 *
 * Esto arma el XML de cada comprobante -sin firmarlo ni enviarlo- y cuenta
 * cuántos pasarían la barrera y cuántos no.
 *
 *   npx tsx scripts/medir-descuadre-centimos.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { construirInvoice, type ItemUbl } from '../src/lib/sunat/ubl'

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
  const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  const { data, error } = await (supabase as any).from('comprobantes').select(`
    id, serie, numero, tipo, fecha_emision, total,
    clientes(razon_social, ruc, dni, direccion),
    comprobantes_items(cantidad, precio_unitario, descripcion, igv_porcentaje,
      productos(codigo, nombre, descripcion, unidades_medida(codigo_sunat)))
  `).in('tipo', ['factura', 'boleta']).neq('estado', 'anulado')
  if (error) throw error

  const filas = (data ?? []) as any[]
  console.log(`\nBARRERA DE TOTALES: ¿cuántos comprobantes pasarían?\n`)
  console.log(`  Revisando ${filas.length} comprobantes.\n`)

  const trabados: { etiqueta: string; fecha: string; erp: number; xml: number }[] = []
  let sinLineas = 0
  let fallados = 0

  for (const c of filas) {
    const items: ItemUbl[] = (c.comprobantes_items ?? []).map((it: any) => ({
      cantidad: Number(it.cantidad),
      precio_unitario: Number(it.precio_unitario),
      igv_porcentaje: it.igv_porcentaje ?? 18,
      descripcion: (it.productos?.descripcion || '').trim() || it.productos?.nombre || it.descripcion || 'PRODUCTO',
      codigo: it.productos?.codigo ?? null,
      unidad: it.productos?.unidades_medida?.codigo_sunat || 'NIU',
    }))
    if (items.length === 0) { sinLineas++; continue }

    try {
      const { totales } = construirInvoice({
        comprobante: {
          serie: c.serie, numero: c.numero, tipo: c.tipo,
          fecha_emision: c.fecha_emision, moneda: 'PEN', forma_pago: 'contado',
          cliente: c.clientes,
        },
        emisor: EMISOR, items,
      })
      // La misma tolerancia que usa el envío.
      if (Math.abs(totales.total - Number(c.total)) > 0.005) {
        trabados.push({
          etiqueta: `${c.serie}-${c.numero}`, fecha: c.fecha_emision,
          erp: Number(c.total), xml: totales.total,
        })
      }
    } catch {
      fallados++
    }
  }

  const pasan = filas.length - trabados.length - sinLineas - fallados
  console.log(`  Pasarían la barrera:   ${pasan}`)
  console.log(`  Quedarían trabados:    ${trabados.length}`)
  if (sinLineas) console.log(`  Sin líneas (se saltan): ${sinLineas}`)
  if (fallados) console.log(`  No se pudo armar el XML: ${fallados}`)

  if (trabados.length > 0) {
    console.log(`\n  Los trabados:\n`)
    for (const t of trabados.slice(0, 20)) {
      const dif = (t.xml - t.erp).toFixed(2)
      console.log(`    ${t.etiqueta}  ${t.fecha}   ERP S/ ${t.erp.toFixed(2)}  ·  XML S/ ${t.xml.toFixed(2)}  (${dif})`)
    }
    if (trabados.length > 20) console.log(`    … y ${trabados.length - 20} más`)
    console.log(`\n  Estos no se declararían: el envío los corta con un 422 antes de`)
    console.log(`  llegar a SUNAT, para no declarar un importe distinto del impreso.`)
  }
  console.log()
}

main().catch((e) => { console.error('\nFALLÓ:', e.message, '\n'); process.exit(1) })
